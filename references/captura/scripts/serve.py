"""Servidor local de la biblioteca estándar: python scripts/serve.py --open."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import sys
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.student_api import StudentApi
STUDENT_API = StudentApi(ROOT)
ALIASES = {
    '/metrics.json': ROOT / 'reports/metrics.json',
    '/downloads/reporte-tecnico.pdf': ROOT / 'docs/reporte-tecnico.pdf',
    '/downloads/experimentacion.ipynb': ROOT / 'notebooks/experimentacion.ipynb',
}

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'web'), **kwargs)

    def do_GET(self):
        if not STUDENT_API.handle(self):
            super().do_GET()

    def do_HEAD(self):
        if not STUDENT_API.handle(self):
            super().do_HEAD()

    def do_POST(self):
        if not STUDENT_API.handle(self):
            self.send_error(405, 'Método no permitido')

    do_PUT = do_POST
    do_DELETE = do_POST
    do_PATCH = do_POST

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def send_head(self):
        from urllib.parse import urlsplit, unquote
        path = unquote(urlsplit(self.path).path)
        if path in ('/health', '/local-info.json'):
            import io
            content = json.dumps({'app': 'yinyan-workshop', 'mode': 'local', 'api_version': 3, 'offline': True}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            return io.BytesIO(content)
        file = ALIASES.get(path)
        if file is not None:
            try:
                stream = file.open('rb')
            except OSError:
                self.send_error(404, 'Archivo local no encontrado')
                return None
            self.send_response(200)
            content_type = 'application/x-ipynb+json' if file.suffix == '.ipynb' else self.guess_type(str(file))
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(file.stat().st_size))
            self.end_headers()
            return stream
        return super().send_head()

    def list_directory(self, path):
        self.send_error(403, 'No se permite listar directorios')
        return None

    def log_message(self, format, *args):
        if args and str(args[1] if len(args) > 1 else '') not in ('200', '304'):
            super().log_message(format, *args)

class LocalHTTPServer(ThreadingHTTPServer):
    # Windows permite dos sockets en el mismo puerto con SO_REUSEADDR.
    # Una segunda apertura debe reutilizar la instancia existente.
    allow_reuse_address = False

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--open', action='store_true', help='Abrir navegador cuando el servidor esté listo')
    parser.add_argument('--port', type=int, default=int(os.environ.get('PORT', '4173')))
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('El puerto debe estar entre 1 y 65535.')
    origin = f'http://127.0.0.1:{args.port}'
    try:
        server = LocalHTTPServer(('127.0.0.1', args.port), Handler)
    except OSError as error:
        try:
            with urllib.request.urlopen(origin + '/health', timeout=1.5) as response:
                info = json.load(response)
                is_this_app = info.get('app') == 'yinyan-workshop'
        except Exception:
            is_this_app = False
        if is_this_app:
            if info.get('api_version', 0) < 3:
                print('Hay una versión anterior de YinYan abierta. Cierra su consola y vuelve a abrir iniciar.cmd.', file=sys.stderr)
                raise SystemExit(1)
            print(f'YinYan Workshop ya está abierto en {origin}')
            if args.open:
                webbrowser.open(origin)
            return
        print(f'No se pudo iniciar el puerto {args.port}: {error}', file=sys.stderr)
        raise SystemExit(1)
    print(f'\nYinYan Workshop - MODO LOCAL\n{origin}\nEl chatbot funciona sin internet. Mantén esta ventana abierta.\nCtrl+C para detener.\n', flush=True)
    if args.open:
        webbrowser.open(origin)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        STUDENT_API.close()
        server.server_close()

if __name__ == '__main__':
    main()
