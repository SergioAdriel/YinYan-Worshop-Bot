"""Verifica el editor Jupyter y su kernel portátil en localhost; no muestra tokens."""
from pathlib import Path
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
PORT = 8893
ORIGIN = f'http://127.0.0.1:{PORT}'

def main():
    python = ROOT / 'runtime/python/python.exe'
    assert python.is_file(), 'Falta el Python portátil.'
    command = [str(python), str(ROOT / 'scripts/notebook-local.py'), '--no-browser', f'--ServerApp.port={PORT}', '--ServerApp.port_retries=0', '--ServerApp.log_level=ERROR']
    process = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace', env={**os.environ, 'PYTHONUTF8': '1'})
    logs = []
    reader = threading.Thread(target=lambda: logs.extend(process.stdout), daemon=True)
    reader.start()
    kernel_id = None
    token = ''
    def request(path, method='GET', data=None):
        body = json.dumps(data).encode() if data is not None else None
        req = urllib.request.Request(ORIGIN + path, data=body, method=method, headers={'Authorization': 'token ' + token, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.read()
    try:
        info_file = ROOT / f'.jupyter-local/runtime/jpserver-{process.pid}.json'
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError('Jupyter terminó antes de estar listo.')
            if info_file.exists():
                try:
                    token = json.loads(info_file.read_text(encoding='utf-8'))['token']
                    json.loads(request('/api'))
                    break
                except (OSError, ValueError, KeyError):
                    pass
            time.sleep(.3)
        else:
            raise RuntimeError('Jupyter no inició en el tiempo previsto.')
        editor = request('/notebooks/notebooks/experimentacion.ipynb').decode()
        assert '<html' in editor.lower()
        scripts = re.findall(r'<script[^>]+src="([^"]+)"', editor)
        assert not any(url.startswith(('http://', 'https://', '//')) for url in scripts)
        for url in scripts[:1]:
            assert len(request(url)) > 100
        specs = json.loads(request('/api/kernelspecs'))
        spec = specs['kernelspecs']['python3']['spec']
        assert Path(spec['argv'][0]).resolve() == python.resolve()
        kernel = json.loads(request('/api/kernels', 'POST', {'name': 'python3'}))
        kernel_id = kernel['id']
        import websocket
        session = uuid.uuid4().hex
        message_id = uuid.uuid4().hex
        socket = websocket.create_connection(f'ws://127.0.0.1:{PORT}/api/kernels/{kernel_id}/channels?session_id={session}', header=['Authorization: token ' + token], origin=ORIGIN, timeout=60)
        code = "import sys,json,joblib; from pathlib import Path; p=joblib.load(Path.cwd()/'models/selected_pipeline.joblib'); print('YINYAN_KERNEL_OK '+json.dumps({'python':sys.executable,'intent':str(p.predict(['Mi celular no carga'])[0])}))"
        socket.send(json.dumps({'header': {'msg_id': message_id, 'username': 'local-check', 'session': session, 'msg_type': 'execute_request', 'version': '5.3'}, 'parent_header': {}, 'metadata': {}, 'content': {'code': code, 'silent': False, 'store_history': False, 'user_expressions': {}, 'allow_stdin': False, 'stop_on_error': True}, 'channel': 'shell', 'buffers': []}))
        evidence = None
        try:
            while True:
                message = json.loads(socket.recv())
                if message.get('parent_header', {}).get('msg_id') != message_id:
                    continue
                kind = message.get('msg_type', message.get('header', {}).get('msg_type'))
                if kind == 'error':
                    raise RuntimeError(message['content'].get('evalue', 'Error del kernel local.'))
                if kind == 'stream' and 'YINYAN_KERNEL_OK ' in message['content'].get('text', ''):
                    evidence = json.loads(message['content']['text'].split('YINYAN_KERNEL_OK ', 1)[1].strip())
                if kind == 'status' and message['content'].get('execution_state') == 'idle':
                    break
        finally:
            socket.close()
        assert evidence and evidence['intent'] == 'carga'
        assert Path(evidence['python']).resolve() == python.resolve()
        report = {'passed': True, 'editor_local': True, 'kernel_uses_bundled_python': True, 'trained_model_loaded': True, 'prediction': 'carga', 'external_script_sources': 0}
        (ROOT / 'reports/notebook-local-results.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps(report), flush=True)
    except Exception as error:
        # Nunca publicar el contenido de los archivos de autenticación local.
        safe_log = re.sub(r'token=[^\s&]+', 'token=[oculto]', ''.join(logs)[-2000:])
        print(f'Fallo al verificar Jupyter: {error}\n{safe_log}', file=sys.stderr)
        raise
    finally:
        if kernel_id:
            try:
                request('/api/kernels/' + kernel_id, 'DELETE')
            except Exception:
                pass
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()

if __name__ == '__main__':
    main()
