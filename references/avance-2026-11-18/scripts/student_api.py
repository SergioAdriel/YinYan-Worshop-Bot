"""API local equivalente al servidor Node; sólo usa la biblioteca estándar."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import threading
from urllib.parse import urlsplit, unquote
import uuid
from scripts.team_store import ApiError, TeamStore, now

MAX_BYTES = 1024 * 1024


class StudentApi:
    def __init__(self, project):
        self.project = project
        self.folder = Path(os.environ.get('YINYAN_DATA_DIR', str(project / 'data/local'))).resolve()
        self.file = self.folder / 'student-examples.json'
        self.store = TeamStore(project, self.folder)
        self.status_file = self.folder / 'training-status.json'
        self.lock = threading.RLock()
        self.process = None
        self.state = {'status': 'idle', 'message': 'Todavía no has entrenado con ejemplos propios.'}
        try:
            saved = json.loads(self.status_file.read_text(encoding='utf-8'))
            if saved['status'] == 'running':
                self.state = {'status': 'failed', 'message': 'El entrenamiento anterior se interrumpió. Puedes intentarlo de nuevo.'}
            elif saved['status'] == 'succeeded' and (self.folder / 'custom-model.json').is_file():
                self.state = saved
            elif saved['status'] == 'failed' and isinstance(saved.get('message'), str):
                self.state = saved
        except (OSError, ValueError, KeyError):
            pass

    def atomic_json(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(path.name + '.' + str(uuid.uuid4()) + '.tmp')
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        temporary.replace(path)

    def load(self):
        return self.store.snapshot()

    @staticmethod
    def body(handler):
        if handler.headers.get('Content-Type', '').split(';')[0].strip().lower() != 'application/json':
            raise ApiError('Envía los datos como application/json.', 415)
        try:
            length = int(handler.headers.get('Content-Length', '0'))
        except ValueError:
            raise ApiError('El tamaño de la solicitud no es válido.')
        if length > MAX_BYTES:
            raise ApiError('El archivo es demasiado grande (máximo 1 MB).', 413)
        if length < 0:
            raise ApiError('El tamaño de la solicitud no es válido.')
        try:
            return json.loads(handler.rfile.read(length))
        except (ValueError, UnicodeError):
            raise ApiError('El contenido no es un JSON válido.')

    @staticmethod
    def send(handler, status, value, allow=None):
        content = json.dumps(value, ensure_ascii=False).encode('utf-8')
        handler.send_response(status)
        handler.send_header('Content-Type', 'application/json; charset=utf-8')
        handler.send_header('Content-Length', str(len(content)))
        if allow:
            handler.send_header('Allow', allow)
        handler.end_headers()
        if handler.command != 'HEAD':
            handler.wfile.write(content)

    @staticmethod
    def same_origin(handler):
        try:
            host = handler.headers.get('Host', '')
            parsed = urlsplit('http://' + host)
            return (parsed.hostname in ('127.0.0.1', 'localhost')
                    and parsed.port == handler.server.server_address[1]
                    and handler.headers.get('Origin', 'http://' + host) == 'http://' + host
                    and handler.headers.get('Sec-Fetch-Site') != 'cross-site')
        except ValueError:
            return False

    def training_state(self):
        revision = self.load()['revision']
        return {**self.state, 'revision': revision, 'stale': bool(self.state.get('result') and self.state.get('trained_revision') != revision)}

    def train(self):
        if self.process:
            raise ApiError('Ya hay un entrenamiento en curso.', 409)
        snapshot = self.load()
        if not snapshot['examples']:
            raise ApiError('Agrega al menos un ejemplo propio antes de reentrenar.')
        training_input = self.folder / 'training-input.json'
        self.atomic_json(training_input, {'examples': snapshot['examples']})
        self.state = {'status': 'running', 'message': 'Entrenando con el día 15 y tus ejemplos revisados…', 'trained_revision': snapshot['revision']}
        self.atomic_json(self.status_file, self.state)
        python = os.environ.get('YINYAN_PYTHON') or sys.executable
        try:
            self.process = subprocess.Popen(
                [python, '-m', 'src.simulation', '--custom', '--examples-file', str(training_input), '--output-dir', str(self.folder)],
                cwd=self.project, env={**os.environ, 'PYTHONUTF8': '1', 'PYTHONDONTWRITEBYTECODE': '1'},
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
            )
        except OSError as error:
            self.state = {'status': 'failed', 'message': f'No se pudo abrir Python: {error}'}
            self.atomic_json(self.status_file, self.state)
            return self.training_state()
        threading.Thread(target=self.finish_training, args=(self.process, snapshot['revision']), daemon=True).start()
        return self.training_state()

    def finish_training(self, child, revision):
        try:
            output, _ = child.communicate(timeout=120)
            if child.returncode != 0:
                raise RuntimeError(output.decode('utf-8', errors='replace')[-600:].strip() or 'Python no pudo completar el entrenamiento.')
            result = json.loads((self.folder / 'custom-result.json').read_text(encoding='utf-8'))
            if not isinstance(result.get('accuracy'), (int, float)) or not 0 <= result['accuracy'] <= 1 or not (self.folder / 'custom-model.json').is_file():
                raise ValueError('El entrenamiento no produjo métricas válidas.')
            trained_at = result.get('trained_at') or now()
            result['trained_at'] = trained_at
            final = {'status': 'succeeded', 'message': 'Entrenamiento terminado. Ya puedes probar tu modelo.', 'trained_revision': revision, 'trained_at': trained_at, 'result': result}
        except Exception as error:
            if child.poll() is None:
                child.kill()
                child.communicate()
            final = {'status': 'failed', 'message': f'No se pudo entrenar: {error}'}
        with self.lock:
            self.state = final
            try:
                self.atomic_json(self.status_file, final)
            except OSError:
                self.state = {'status': 'failed', 'message': 'El entrenamiento terminó, pero no se pudo guardar su estado.'}
            self.process = None

    def handle(self, handler):
        path = unquote(urlsplit(handler.path).path)
        if path != '/simulation/custom-model.json' and not path.startswith('/api/'):
            return False
        with self.lock:
            try:
                if not self.same_origin(handler):
                    raise ApiError('Esta operación solo está disponible desde la página local.', 403)
                method = handler.command
                if path == '/simulation/custom-model.json':
                    if method not in ('GET', 'HEAD'):
                        self.send(handler, 405, {'error': 'Método no permitido.'}, 'GET, HEAD')
                        return True
                    try:
                        content = (self.folder / 'custom-model.json').read_bytes()
                    except FileNotFoundError:
                        raise ApiError('Todavía no hay un modelo propio. Reentrena primero.', 404)
                    handler.send_response(200)
                    handler.send_header('Content-Type', 'application/json; charset=utf-8')
                    handler.send_header('Content-Length', str(len(content)))
                    handler.end_headers()
                    if method != 'HEAD':
                        handler.wfile.write(content)
                    return True
                if path == '/api/examples':
                    if method in ('GET', 'HEAD'):
                        self.send(handler, 200, self.load())
                        return True
                    if method not in ('POST', 'PUT'):
                        self.send(handler, 405, {'error': 'Método no permitido.'}, 'GET, HEAD, POST, PUT')
                        return True
                    data = self.body(handler)
                    if method == 'POST':
                        result = self.store.create_example(data)
                    else:
                        result = self.store.import_examples(data)
                    self.send(handler, 201 if method == 'POST' else 200, result)
                    return True
                if path.startswith('/api/examples/'):
                    if method != 'DELETE':
                        self.send(handler, 405, {'error': 'Método no permitido.'}, 'DELETE')
                        return True
                    row_id = path[len('/api/examples/'):]
                    data = self.body(handler) if handler.headers.get('Content-Length', '0') != '0' else {}
                    self.send(handler, 200, self.store.delete_example(row_id, data))
                    return True
                if path == '/api/queries':
                    if method in ('GET', 'HEAD'):
                        self.send(handler, 200, self.store.queries())
                    elif method == 'POST':
                        status, result = self.store.create_query(self.body(handler))
                        self.send(handler, status, result)
                    else:
                        self.send(handler, 405, {'error': 'Método no permitido.'}, 'GET, HEAD, POST')
                    return True
                if path.startswith('/api/queries/') and path.endswith('/example'):
                    if method != 'POST':
                        self.send(handler, 405, {'error': 'Método no permitido.'}, 'POST')
                        return True
                    query_id = path[len('/api/queries/'):-len('/example')]
                    status, result = self.store.review_query(query_id, self.body(handler))
                    self.send(handler, status, result)
                    return True
                if path == '/api/training' and method in ('GET', 'HEAD'):
                    self.send(handler, 200, self.training_state())
                    return True
                if path == '/api/train':
                    if method != 'POST':
                        self.send(handler, 405, {'error': 'Método no permitido.'}, 'POST')
                        return True
                    self.body(handler)
                    self.send(handler, 202, self.train())
                    return True
                raise ApiError('Ruta local no encontrada.', 404)
            except ApiError as error:
                self.send(handler, error.status, {'error': str(error)})
            except (OSError, ValueError, TypeError):
                self.send(handler, 500, {'error': 'No se pudo completar la operación local. Revisa permisos y espacio disponible.'})
        return True

    def close(self):
        with self.lock:
            if self.process and self.process.poll() is None:
                self.process.kill()
