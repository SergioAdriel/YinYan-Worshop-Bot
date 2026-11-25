r"""Comprueba el entorno local sin internet ni reentrenar o alterar modelos.

Desde la raíz: runtime\python\python.exe scripts\local-environment-check.py
También admite un Python propio con las dependencias instaladas.
"""
from pathlib import Path
from hashlib import sha256
import io
import json
import os
import platform
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

def main():
    os.environ.setdefault('MPLCONFIGDIR', str(ROOT/'.jupyter-local/matplotlib'))
    import numpy as np
    import pandas as pd
    import scipy
    import scipy.sparse
    import sklearn
    import joblib
    import matplotlib
    from matplotlib.figure import Figure
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    import nbformat
    import nbclient
    import ipykernel
    import notebook as notebook_package
    import jupyter_server
    import zmq
    import reportlab
    import pypdf

    # Estas operaciones ejercitan extensiones compiladas, no solo su importación.
    matrix = scipy.sparse.csr_matrix([[1.0, 2.0], [3.0, 4.0]])
    assert np.allclose(matrix @ np.array([1.0, 1.0]), [3.0, 7.0])
    figure = Figure(figsize=(1, 1))
    FigureCanvasAgg(figure)
    figure.add_subplot().plot([0, 1], [0, 1])
    png = io.BytesIO()
    figure.savefig(png, format='png')
    assert png.getvalue().startswith(b'\x89PNG')

    metrics = json.loads((ROOT/'reports/metrics.json').read_text(encoding='utf-8'))
    for split, expected in metrics['data_hashes'].items():
        actual = sha256((ROOT/f'data/{split}.csv').read_bytes()).hexdigest()
        assert actual == expected, f'El conjunto {split} difiere de la versión evaluada.'
    training = pd.read_csv(ROOT/'data/train.csv')
    assert len(training) == metrics['counts']['train']

    pipeline = joblib.load(ROOT/'models/selected_pipeline.joblib')
    references = json.loads((ROOT/'reports/parity_reference.json').read_text(encoding='utf-8'))
    messages = [sample['text'] for sample in references]
    actual_probabilities = pipeline.predict_proba(messages)
    expected_probabilities = np.array([sample['probabilities'] for sample in references])
    assert np.allclose(actual_probabilities, expected_probabilities, rtol=0, atol=1e-10)
    assert list(pipeline.predict(messages)) == [sample['intent'] for sample in references]

    notebook = nbformat.read(ROOT/'notebooks/experimentacion.ipynb', as_version=4)
    cells = [cell for cell in notebook.cells if cell.cell_type == 'code']
    assert all(cell.get('execution_count') is not None for cell in cells)
    assert not any(output.get('output_type') == 'error' for cell in cells for output in cell.get('outputs', []))
    assert notebook.metadata.kernelspec.name == 'python3'

    runtime = ROOT/'runtime/python'
    using_portable = Path(sys.executable).resolve().parent == runtime.resolve()
    if using_portable:
        path_files = list(runtime.glob('*._pth'))
        assert path_files, 'Falta la configuración de rutas del Python portátil.'
        for path_file in path_files:
            lines = [line.strip() for line in path_file.read_text().splitlines()]
            for line in lines:
                if line and not line.startswith(('#', 'import ')):
                    assert not Path(line).is_absolute(), 'El Python portátil contiene una ruta absoluta.'
        assert any((runtime/line).resolve() == ROOT for line in lines if line and not line.startswith(('#', 'import ')))

    print(json.dumps({
        'ok': True,
        'project': ROOT.name,
        'offline_check': True,
        'using_bundled_python': using_portable,
        'python': platform.python_version(),
        'architecture': platform.machine(),
        'versions': {'numpy': np.__version__, 'scipy': scipy.__version__,
                     'pandas': pd.__version__, 'scikit-learn': sklearn.__version__,
                     'matplotlib': matplotlib.__version__, 'joblib': joblib.__version__,
                     'notebook': notebook_package.__version__, 'jupyter-server': jupyter_server.__version__},
        'unchanged_dataset_splits': sorted(metrics['data_hashes']),
        'model_reference_cases': len(references),
        'maximum_probability_difference': float(np.abs(actual_probabilities-expected_probabilities).max()),
        'executed_notebook_cells': len(cells)
    }, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
