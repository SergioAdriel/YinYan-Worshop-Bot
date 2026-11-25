"""Validate the generated notebook/PDF against the same frozen journey."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def verify_delivery():
    import nbformat
    from pypdf import PdfReader
    from src.training_runs import atomic_json, Registry

    read = lambda name: json.loads((ROOT / name).read_text(encoding='utf-8-sig'))
    experiment = read('reports/current-experiment.json')
    document = read('docs/pdf-verification.json')
    notebook = nbformat.read(ROOT / 'notebooks/experimentacion.ipynb', as_version=4)
    nbformat.validate(notebook)
    cells = [cell for cell in notebook.cells if cell.cell_type == 'code']
    assert cells and all(cell.execution_count is not None for cell in cells), 'El notebook tiene celdas sin ejecutar.'
    errors = sum(output.output_type == 'error' for cell in cells for output in cell.outputs)
    assert errors == 0, 'El notebook contiene errores de ejecución.'
    assert notebook.metadata.get('yinyan_version_id') == experiment.get('version_id') == document.get('version_id'), 'Notebook, métricas y PDF corresponden a jornadas distintas.'
    assert document['notebook']['sha256'] == sha256((ROOT / 'notebooks/experimentacion.ipynb').read_bytes()).hexdigest()
    assert document['metrics_sha256'] == sha256((ROOT / 'reports/current-experiment.json').read_bytes()).hexdigest()
    assert document['active_model'] == experiment['active_model']
    pdf = PdfReader(ROOT / 'docs/reporte-tecnico.pdf')
    assert len(pdf.pages) == document['pages'] and document['main_content_pages'] <= 8
    full_text = '\n'.join(page.extract_text() for page in pdf.pages)
    full_text = ' '.join(full_text.split())
    for name in experiment['team']['integrantes']:
        assert name in full_text, 'Falta un integrante en el PDF: ' + name
    for name in experiment['models']:
        value = experiment['models'][name]
        assert f"{100 * value['accuracy']:.2f}%" in full_text
        assert sum(map(sum, value['confusion_matrix'])) == value['total']
    assert len(experiment['team']['roles']) == 4
    assert '18 de noviembre de 2026' in full_text and '4 de diciembre de 2026' in full_text
    version_id = experiment.get('version_id')
    if version_id:
        registry = Registry()
        registry.validate_artifacts(version_id)
        assert registry.version(version_id)['selected_model'] == experiment['active_model']
    # La captura se verifica byte por byte usando su manifiesto original.
    reference = ROOT / 'references/captura'
    original = json.loads((reference / 'BACKUP.json').read_text(encoding='utf-8'))
    assert all(sha256((reference / row['path']).read_bytes()).hexdigest() == row['sha256'] for row in original['files']), 'Cambió la referencia histórica.'
    assert not (ROOT / 'entrega-yinyan-workshop.zip').exists()
    artifacts = ['notebooks/experimentacion.ipynb', 'docs/reporte-tecnico.pdf', 'docs/pdf-verification.json', 'reports/current-experiment.json']
    report = {
        'checked_at': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
        'passed': True, 'version_id': version_id, 'dataset_version': experiment.get('dataset_version'),
        'notebook_code_cells': len(cells), 'notebook_errors': errors,
        'pdf_pages': len(pdf.pages), 'main_content_pages': document['main_content_pages'],
        'active_model': experiment['active_model'],
        'active_accuracy': experiment['models'][experiment['active_model']]['accuracy'],
        'four_members_present': True, 'reference_files_intact': len(original['files']),
        'artifact_hashes': {name: sha256((ROOT / name).read_bytes()).hexdigest() for name in artifacts},
    }
    atomic_json(ROOT / 'reports/current-delivery-verification.json', report)
    return report


if __name__ == '__main__':
    print(json.dumps(verify_delivery(), ensure_ascii=True))
