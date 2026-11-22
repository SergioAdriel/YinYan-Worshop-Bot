"""Local HTTP API: review examples, compare and activate versioned models."""
from __future__ import annotations
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
from urllib.parse import urlsplit, unquote
from scripts.team_store import ApiError, TeamStore
from src.training_runs import Registry, WorkflowError, atomic_json, read_json, progress

MAX_BYTES = 1024 * 1024


class StudentApi:
    def __init__(self, project):
        self.project = Path(project)
        self.folder = Path(os.environ.get('YINYAN_DATA_DIR', str(project / 'data/local'))).resolve()
        self.store = TeamStore(project, self.folder)
        self.registry = Registry(self.folder)
        self.registry.recover()
        self.status_file = self.folder / 'training-status.json'
        self.lock = threading.RLock()
        self.process = None
        self.process_run = None

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
        if length < 0 or length > MAX_BYTES:
            raise ApiError('El tamaño de la solicitud no es válido (máximo 1 MB).', 413)
        try:
            data = json.loads(handler.rfile.read(length))
        except (ValueError, UnicodeError):
            raise ApiError('El contenido no es un JSON válido.')
        if not isinstance(data, dict):
            raise ApiError('El contenido debe ser un objeto JSON.')
        return data

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
        snapshot = self.load()
        history = self.registry.versions()
        latest = history[0] if history else None
        legacy = read_json(self.status_file, {}) if not latest else {}
        revision = snapshot.get('approved_revision', snapshot['revision'])
        state = {'status': latest['status'] if latest else legacy.get('status', 'idle'),
                 'message': latest['message'] if latest else legacy.get('message', 'Todavía no hay una jornada de entrenamiento.'),
                 'revision': revision, 'active_id': self.registry.active_id(), 'runs': history,
                 'run_id': latest['id'] if latest else None, 'stale': False}
        if latest:
            state.update(trained_revision=latest['approved_revision'], trained_at=latest.get('finished_at'), journey=latest['journey'],
                         stale=latest['approved_revision'] != revision)
            if latest['status'] == 'succeeded':
                state['result'] = {**latest['models'][latest['selected_model']], 'trained_at': latest['finished_at'],
                                   'total_examples': latest['counts']['total'], 'additional_examples': latest['counts']['additional'],
                                   'selected_model': latest['selected_model'], 'model_url': latest['model_url'], 'run_id': latest['id'],
                                   'journey': latest['journey'], 'dataset_version': latest['dataset_version'],
                                   'approval_status': latest['approval_status']}
        return state

    def train(self, data):
        if self.process:
            raise ApiError('Ya hay un entrenamiento en curso.', 409)
        run = self.registry.reserve(self.load(), data.get('author', 'system'))
        python = os.environ.get('YINYAN_PYTHON') or sys.executable
        try:
            self.process = subprocess.Popen(
                [python, '-m', 'src.training_runs', 'train', '--runtime', str(self.folder), '--id', run['id']],
                cwd=self.project, env={**os.environ, 'PYTHONUTF8': '1', 'PYTHONDONTWRITEBYTECODE': '1'},
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
            self.process_run = run['id']
        except OSError as error:
            self.registry.fail(run['id'], f'No se pudo abrir Python: {error}')
            return self.training_state()
        threading.Thread(target=self.finish_training, args=(self.process, run['id']), daemon=True).start()
        return self.training_state()

    def finish_training(self, child, run_id):
        try:
            output, _ = child.communicate(timeout=300)
            if child.returncode:
                self.registry.fail(run_id, output.decode('utf-8', errors='replace')[-1200:].strip() or 'Python no completó la jornada.')
        except Exception as error:
            if child.poll() is None:
                child.kill()
                child.communicate()
            self.registry.fail(run_id, str(error))
        with self.lock:
            self.process = None
            self.process_run = None
            try:
                atomic_json(self.status_file, self.training_state())
            except OSError:
                pass

    def handle(self, handler):
        path = unquote(urlsplit(handler.path).path)
        if path != '/simulation/custom-model.json' and not path.startswith('/api/'):
            return False
        with self.lock:
            try:
                if not self.same_origin(handler):
                    raise ApiError('Esta operación solo está disponible desde la página local.', 403)
                method = handler.command
                get = method in ('GET', 'HEAD')
                if path == '/api/team' and get:
                    self.send(handler, 200, read_json(self.project / 'docs/equipo.json'))
                elif path == '/api/examples':
                    if get:
                        self.send(handler, 200, self.load())
                    elif method in ('POST', 'PUT'):
                        data = self.body(handler)
                        result = self.store.create_example(data) if method == 'POST' else self.store.import_examples(data)
                        self.send(handler, 201 if method == 'POST' else 200, result)
                    else:
                        self.send(handler, 405, {'error': 'Método no permitido.'}, 'GET, HEAD, POST, PUT')
                elif path.startswith('/api/examples/'):
                    parts = path[len('/api/examples/'):].split('/')
                    if len(parts) == 2 and parts[1] == 'review' and method == 'POST':
                        self.send(handler, 200, self.store.review_example(parts[0], self.body(handler)))
                    elif len(parts) == 1 and method == 'PATCH':
                        self.send(handler, 200, self.store.edit_example(parts[0], self.body(handler)))
                    elif len(parts) == 1 and method == 'DELETE':
                        data = self.body(handler) if handler.headers.get('Content-Length', '0') != '0' else {}
                        self.send(handler, 200, self.store.delete_example(parts[0], data))
                    else:
                        self.send(handler, 405, {'error': 'Método no permitido.'}, 'PATCH, DELETE, POST')
                elif path == '/api/queries':
                    if get:
                        self.send(handler, 200, self.store.queries())
                    elif method == 'POST':
                        status, result = self.store.create_query(self.body(handler))
                        self.send(handler, status, result)
                    else:
                        self.send(handler, 405, {'error': 'Método no permitido.'}, 'GET, HEAD, POST')
                elif path.startswith('/api/queries/') and path.endswith('/example'):
                    if method != 'POST':
                        raise ApiError('Método no permitido.', 405)
                    status, result = self.store.review_query(path[len('/api/queries/'):-len('/example')], self.body(handler))
                    self.send(handler, status, result)
                elif path == '/api/training/catalog' and get:
                    catalog = read_json(self.project / 'data/training/training_history.json')
                    self.send(handler, 200, {key: catalog[key] for key in ('labels', 'references', 'reference_curve')})
                elif path == '/api/training' and get:
                    self.send(handler, 200, self.training_state())
                elif path == '/api/train':
                    if method != 'POST':
                        raise ApiError('Método no permitido.', 405)
                    self.send(handler, 202, self.train(self.body(handler)))
                elif path == '/api/versions' and get:
                    self.send(handler, 200, {'versions': self.registry.versions(), 'active_id': self.registry.active_id(),
                                             'baseline': {'model_url': './simulation/day-15.json', 'model': 'naive_bayes', 'examples': 240}})
                elif path == '/api/models/active' and get:
                    self.send(handler, 200, self.registry.active())
                elif path == '/api/progress' and get:
                    self.send(handler, 200, progress(self.load(), self.folder))
                elif path == '/simulation/custom-model.json' and get:
                    latest = next((row for row in self.registry.versions() if row['status'] == 'succeeded'), None)
                    if latest:
                        self.send(handler, 200, read_json(self.registry.run_folder(latest['id']) / 'model.json'))
                    elif (self.folder / 'custom-model.json').is_file():
                        self.send(handler, 200, read_json(self.folder / 'custom-model.json'))
                    else:
                        raise ApiError('Todavía no hay una versión entrenada.', 404)
                else:
                    match = re.fullmatch(r'/api/versions/([^/]+)(?:/(model\.json|activate|evaluate-final))?', path)
                    if not match:
                        raise ApiError('Ruta local no encontrada.', 404)
                    run_id, operation = match.groups()
                    if operation is None and get:
                        self.send(handler, 200, self.registry.version(run_id))
                    elif operation == 'model.json' and get:
                        run = self.registry.version(run_id)
                        if run['status'] != 'succeeded':
                            raise ApiError('La versión todavía no tiene un modelo válido.', 409)
                        self.send(handler, 200, read_json(self.registry.run_folder(run_id) / 'model.json'))
                    elif operation in ('activate', 'evaluate-final') and method == 'POST':
                        data = self.body(handler)
                        result = self.registry.activate(run_id, data.get('author', 'system')) if operation == 'activate' else self.registry.evaluate_final(run_id, data.get('author', 'system'))
                        self.send(handler, 200, result)
                    else:
                        raise ApiError('Método no permitido.', 405)
            except (ApiError, WorkflowError) as error:
                self.send(handler, error.status, {'error': str(error)})
            except (OSError, ValueError, TypeError, KeyError) as error:
                self.send(handler, 500, {'error': 'No se pudo completar la operación local: ' + str(error)})
        return True

    def close(self):
        with self.lock:
            if self.process and self.process.poll() is None:
                self.process.kill()
                self.registry.fail(self.process_run, 'El servidor se cerró durante el entrenamiento. Se conservó el modelo activo.')
