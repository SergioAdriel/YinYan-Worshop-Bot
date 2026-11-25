"""Abre Jupyter con el Python actual y configuración dentro de este proyecto."""
from pathlib import Path
import json
import os
import sys

ROOT = Path(__file__).resolve().parents[1]
state = ROOT / '.jupyter-local'
for key, directory in {
    'JUPYTER_CONFIG_DIR': state / 'config',
    'JUPYTER_DATA_DIR': state / 'data',
    'JUPYTER_RUNTIME_DIR': state / 'runtime',
    'IPYTHONDIR': state / 'ipython',
    'MPLCONFIGDIR': state / 'matplotlib',
}.items():
    directory.mkdir(parents=True, exist_ok=True)
    os.environ[key] = str(directory)
kernel_dir = state / 'data/kernels/python3'
kernel_dir.mkdir(parents=True, exist_ok=True)
(kernel_dir / 'kernel.json').write_text(json.dumps({
    'argv': [sys.executable, '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
    'display_name': 'Python 3 (YinYan local)', 'language': 'python',
}, indent=2), encoding='utf-8')
os.chdir(ROOT)
config_file = state / 'config/jupyter_server_config.py'
config_file.write_text("c = get_config()\nc.ServerApp.ip = '127.0.0.1'\nc.ServerApp.port = 8888\nc.ServerApp.port_retries = 10\nc.ServerApp.root_dir = " + repr(str(ROOT)) + "\nc.LabApp.news_url = None\nc.LabApp.check_for_updates_class = 'jupyterlab.handlers.announcements.NeverCheckForUpdate'\nc.LabApp.extension_manager = 'readonly'\n", encoding='utf-8')
from notebook.app import main
extra = sys.argv[1:]
sys.argv = ['notebook', str(ROOT / 'notebooks/experimentacion.ipynb'), '--config=' + str(config_file), *extra]
main()
