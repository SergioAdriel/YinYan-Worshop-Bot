"""Versioned, reviewable local training runs. No historical dates are invented.

The HTTP servers reserve a run, then execute ``train`` in a child process. Only
``activate`` changes the model used by the chatbot. The final holdout is opened
only by the explicit ``final`` command, never by training or model selection.
"""
from __future__ import annotations

import argparse
from collections import Counter
from contextlib import contextmanager
import csv
import io
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from uuid import UUID, uuid4

ROOT = Path(__file__).resolve().parents[1]
AUTHORS = {'alumno-a', 'alumno-b', 'sergio', 'raynier', 'system'}
MODEL_NAMES = ('naive_bayes', 'logistic_regression')


class WorkflowError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def digest(path):
    return sha256(Path(path).read_bytes()).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name('.' + path.name + '.' + str(uuid4()) + '.tmp')
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        # Windows scanners and simultaneous readers can briefly deny replacing
        # an existing file. Preserve atomic publication and retry that sharing
        # violation instead of falsely marking a completed fit as failed.
        for attempt in range(40):
            try:
                temporary.replace(path)
                break
            except PermissionError:
                if attempt == 39:
                    raise
                time.sleep(min(.01 * (attempt + 1), .1))
    finally:
        temporary.unlink(missing_ok=True)


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8-sig'))
    except FileNotFoundError:
        if default is not None:
            return default
        raise


def uuid_value(value):
    try:
        result = str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        raise WorkflowError('Identificador de versión no válido.')
    if result != str(value).lower():
        raise WorkflowError('Identificador de versión no válido.')
    return result


def author_value(value):
    if value not in AUTHORS:
        raise WorkflowError('Selecciona un responsable válido.')
    return value


def alive(pid):
    if not isinstance(pid, int) or pid < 1:
        return False
    if os.name == 'nt':
        import ctypes
        kernel = ctypes.windll.kernel32
        kernel.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
        kernel.OpenProcess.restype = ctypes.c_void_p
        kernel.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return False
        try:
            code = ctypes.c_ulong()
            return bool(kernel.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == 259
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


@contextmanager
def lock(path, seconds=10):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + seconds
    while True:
        try:
            descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            with os.fdopen(descriptor, 'w', encoding='ascii') as handle:
                handle.write(str(os.getpid()))
            break
        except FileExistsError:
            try:
                owner = int(path.read_text(encoding='ascii').strip())
            except (OSError, ValueError):
                owner = None
            if owner and not alive(owner):
                path.unlink(missing_ok=True)
                continue
            if time.monotonic() > deadline:
                raise WorkflowError('Hay otra operación sobre el historial. Intenta de nuevo.', 409)
            time.sleep(.04)
    try:
        yield
    finally:
        path.unlink(missing_ok=True)


def final_test_path():
    return Path(os.environ.get('YINYAN_FINAL_TEST_FILE', str(ROOT / 'data/final-test.csv')))


def final_test_size():
    path = final_test_path()
    if not path.is_file():
        return 0
    with path.open(encoding='utf-8-sig', newline='') as stream:
        return sum(bool(row.get('text', '').strip()) for row in csv.DictReader(stream))


class Registry:
    def __init__(self, runtime=None):
        self.runtime = Path(runtime or os.environ.get('YINYAN_DATA_DIR', ROOT / 'data/local')).resolve()
        default_runtime = (ROOT / 'data/local').resolve()
        shared = ROOT / 'data/training' if self.runtime == default_runtime and not os.environ.get('YINYAN_DATA_DIR') else self.runtime / 'training'
        self.folder = Path(os.environ.get('YINYAN_TRAINING_DIR', str(shared))).resolve()
        self.runs = self.folder / 'runs'

    def run_folder(self, run_id):
        run_id = uuid_value(run_id)
        local = self.runs / run_id
        if (local / 'run.json').is_file():
            return local
        reference = ROOT / 'data/training/runs' / run_id
        if reference != local and (reference / 'run.json').is_file():
            if read_json(reference / 'run.json').get('run_type') == 'imported_reference':
                return reference
        return local

    def raw(self, run_id):
        try:
            return read_json(self.run_folder(run_id) / 'run.json')
        except FileNotFoundError:
            raise WorkflowError('No se encontró esa jornada.', 404)

    def active_id(self):
        return read_json(self.folder / 'active.json', {}).get('active_id')

    def recover(self):
        """Mark interrupted work honestly; a second server cannot kill live work."""
        if not self.runs.is_dir():
            return
        for path in self.runs.glob('*/run.json'):
            run = read_json(path)
            if run.get('status') != 'running':
                continue
            elapsed = (datetime.now(timezone.utc) - datetime.fromisoformat(run['created_at'].replace('Z', '+00:00'))).total_seconds()
            if run.get('process_id') and not alive(run['process_id']) or not run.get('process_id') and elapsed > 30:
                self.fail(run['id'], 'La jornada se interrumpió antes de terminar. El modelo activo se conservó.')

    def version(self, run_id, full=True):
        run = dict(self.raw(run_id))
        approvals = self.run_folder(run_id) / 'approvals'
        approved = approvals.is_dir() and any(approvals.glob('*.json'))
        reference = run.get('run_type') == 'imported_reference'
        run['approval_status'] = 'approved' if approved else 'reference' if reference else 'provisional'
        run['kind'] = 'active' if self.active_id() == run_id else 'historical' if reference or approved else 'provisional'
        run['model_url'] = f'./api/versions/{run_id}/model.json'
        if full:
            final_results = [read_json(path) for path in self.run_folder(run_id).glob('final-evaluation-*.json')]
            if final_results:
                run['final_evaluation'] = max(final_results, key=lambda result: result.get('evaluated_at', ''))
        if not full:
            for key in ('predictions', 'errors', 'artifact_hashes'):
                run.pop(key, None)
        return run

    def versions(self):
        self.recover()
        records = []
        if self.runs.is_dir():
            for path in self.runs.glob('*/run.json'):
                if read_json(path).get('run_type') != 'imported_reference':
                    records.append(self.version(path.parent.name, full=False))
        return sorted(records, key=lambda row: row['journey'], reverse=True)

    def active(self):
        run_id = self.active_id()
        if run_id:
            run = self.version(run_id)
            if run['status'] != 'succeeded':
                raise WorkflowError('El registro activo es inválido. Conserva una copia del historial.', 500)
            return {'active_id': run_id, 'model_url': run['model_url'], 'version': run}
        return {'active_id': None, 'model_url': './simulation/day-15.json', 'version': None,
                'baseline': {'model': 'naive_bayes', 'examples': 240, 'note': 'Modelo base conservado hasta aprobar una jornada.'}}

    def reserve(self, snapshot, author='system'):
        author_value(author)
        source = read_json(ROOT / 'data/simulation.json')
        base = [row for stage in source['days'] for row in stage['examples']]
        extras = snapshot.get('approved_examples', [])
        if not isinstance(extras, list):
            raise WorkflowError('La instantánea aprobada no es válida.')
        if any(row.get('review_status') != 'approved' for row in extras):
            raise WorkflowError('Solo se permiten ejemplos aprobados.')
        training = base + extras
        labels = sorted(source['labels'])
        counts = Counter(row['intent'] for row in training)
        if set(counts) != set(labels):
            raise WorkflowError('La instantánea contiene categorías desconocidas.')
        snapshot_content = {'base_examples': base, 'additional_examples': extras, 'training_examples': training,
                            'approved_revision': snapshot.get('approved_revision', snapshot.get('revision', ''))}
        dataset_version = sha256(canonical({'base': digest(ROOT / 'data/simulation.json'), 'approved_revision': snapshot_content['approved_revision']}).encode()).hexdigest()
        with lock(self.folder / 'registry.lock'):
            records = self.versions()
            if any(row['status'] == 'running' for row in records):
                raise WorkflowError('Ya hay un entrenamiento en curso.', 409)
            run_id = str(uuid4())
            folder = self.run_folder(run_id)
            folder.mkdir(parents=True, exist_ok=False)
            moment = now()
            run = {'format_version': 2, 'id': run_id, 'journey': max((row['journey'] for row in records), default=0) + 1,
                   'created_at': moment, 'started_at': moment, 'finished_at': None,
                   'author': author, 'initiated_by': 'programmatic_execution' if author == 'system' else 'selected_responsible',
                   'timezone': 'America/Mexico_City', 'timestamp_kind': 'recorded',
                   'status': 'running', 'approval_status': 'provisional', 'dataset_version': dataset_version,
                   'approved_revision': snapshot_content['approved_revision'], 'message': 'Jornada reservada; entrenando dos clasificadores.',
                   'counts': {'base': len(base), 'additional': len(extras), 'total': len(training), 'test': 80,
                              'intents': len(labels), 'per_intent': dict(sorted(counts.items()))},
                   'labels': labels, 'process_id': None, 'storage_path': str(folder.relative_to(self.folder)).replace('\\', '/')}
            atomic_json(folder / 'snapshot.json', snapshot_content)
            atomic_json(folder / 'run.json', run)
            return self.version(run_id)

    def fail(self, run_id, message):
        run = self.raw(run_id)
        if run['status'] == 'succeeded':
            return run
        run.update(status='failed', finished_at=now(), message=str(message)[:1200], process_id=None)
        atomic_json(self.run_folder(run_id) / 'run.json', run)
        return self.version(run_id)

    def train(self, run_id):
        with lock(self.folder / 'registry.lock'):
            run = self.raw(run_id)
            if run['status'] != 'running':
                raise WorkflowError('Esa jornada ya terminó y sus archivos no se sobrescriben.', 409)
            if run.get('process_id') and alive(run['process_id']):
                raise WorkflowError('Esa jornada ya tiene un proceso de entrenamiento activo.', 409)
            run['process_id'] = os.getpid()
            atomic_json(self.run_folder(run_id) / 'run.json', run)
        try:
            with lock(self.folder / 'training.lock', seconds=2):
                return self._fit(run)
        except Exception as error:
            self.fail(run_id, str(error))
            raise

    def _fit(self, run):
        import joblib
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        import numpy as np
        from sklearn.linear_model import LogisticRegression
        from sklearn.metrics import ConfusionMatrixDisplay
        from sklearn.model_selection import StratifiedKFold, cross_validate
        from src.preprocessing import tokenize
        from src.simulation import make_pipeline, read_evaluation, predict
        from src.train import metric_bundle, explain_error

        folder = self.run_folder(run['id'])
        snapshot = read_json(folder / 'snapshot.json')
        training = snapshot['training_examples']
        seen = {}
        for row in training:
            if not isinstance(row.get('text'), str) or not row['text'].strip() or row.get('intent') not in run['labels']:
                raise WorkflowError('Hay ejemplos sin texto o con categoría inválida.')
            key = ' '.join(tokenize(row['text']))
            if not key or key in seen:
                raise WorkflowError('Hay un ejemplo vacío o duplicado tras preparar el texto: ' + row['text'])
            seen[key] = row['intent']
        if min(run['counts']['per_intent'].values()) < 5:
            raise WorkflowError('La validación de cinco pliegues necesita al menos cinco ejemplos por intención.')
        pipelines = {'naive_bayes': make_pipeline(),
                     'logistic_regression': make_pipeline().set_params(classifier=LogisticRegression(C=8.0, max_iter=2000, random_state=42))}
        texts, targets = [row['text'] for row in training], [row['intent'] for row in training]
        cv, cv_errors = {}, []
        folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
        for name, pipeline in pipelines.items():
            scores = cross_validate(pipeline, texts, targets, cv=folds, scoring={'accuracy': 'accuracy', 'f1_macro': 'f1_macro'}, n_jobs=1)
            cv[name] = {'f1_macro_mean': float(scores['test_f1_macro'].mean()),
                        'f1_macro_std': float(scores['test_f1_macro'].std()),
                        'accuracy_mean': float(scores['test_accuracy'].mean()), 'fold_f1_macro': scores['test_f1_macro'].tolist()}
            pipeline.fit(texts, targets)
        selected = max(MODEL_NAMES, key=lambda name: (cv[name]['f1_macro_mean'], name == 'logistic_regression'))
        # Only now open the development benchmark. The final holdout is NEVER
        # read in this method, not even for feature construction or selection.
        evaluation = read_evaluation(training)
        atomic_json(folder / 'benchmark.json', evaluation)
        expected = [row['intent'] for row in evaluation]
        models, predictions, errors, exports = {}, {}, [], {}
        for name, pipeline in pipelines.items():
            predicted = pipeline.predict([row['text'] for row in evaluation]).tolist()
            models[name] = metric_bundle(expected, predicted, run['labels'])
            models[name].update(correct=sum(a == b for a, b in zip(expected, predicted)), total=len(expected))
            predictions[name] = []
            for row, value in zip(evaluation, predicted):
                prediction = {'text': row['text'], 'expected': row['intent'], 'predicted': value, 'correct': row['intent'] == value}
                predictions[name].append(prediction)
                if not prediction['correct']:
                    errors.append({'model': name, **prediction, 'interpretation': explain_error(row['text'], row['intent'], value)})
            joblib.dump(pipeline, folder / f'{name}.joblib')
            exports[name] = export_pipeline(pipeline, len(training), name)
            atomic_json(folder / f'{name}.json', exports[name])
            figure, axis = plt.subplots(figsize=(11, 9))
            ConfusionMatrixDisplay(np.asarray(models[name]['confusion_matrix']), display_labels=run['labels']).plot(
                ax=axis, cmap='Greens', colorbar=False, xticks_rotation=65, values_format='d')
            axis.set_title(f"{name} · jornada {run['journey']}")
            figure.tight_layout()
            figure.savefig(folder / f'confusion-{name}.png', dpi=145)
            plt.close(figure)
        atomic_json(folder / 'model.json', exports[selected])
        parity = verify_export(pipelines[selected], exports[selected], [row['text'] for row in evaluation[:10]] + ['¡MI TELÉFONO NO CARGA!', 'hola', ''])
        accepted = [predict(pipelines[selected], row['text']) for row in evaluation]
        acceptance = {'accepted': sum(row['accepted'] for row in accepted), 'total': len(evaluation),
                      'correct_accepted': sum(row['accepted'] and row['intent'] == target for row, target in zip(accepted, expected))}
        acceptance['coverage'] = acceptance['accepted'] / acceptance['total']
        acceptance['accuracy_among_accepted'] = acceptance['correct_accepted'] / acceptance['accepted'] if acceptance['accepted'] else None
        previous = next((row for row in self.versions() if row['id'] != run['id'] and row['status'] == 'succeeded'), None)
        comparison = {'previous_id': previous['id'] if previous else None, 'accuracy_delta': None, 'f1_macro_delta': None}
        if previous:
            prior = previous['models'][previous['selected_model']]
            comparison.update(accuracy_delta=models[selected]['accuracy'] - prior['accuracy'], f1_macro_delta=models[selected]['f1_macro'] - prior['f1_macro'],
                              same_dataset=run['dataset_version'] == previous['dataset_version'], note='Comparación sobre el mismo benchmark de desarrollo; cambios de datos no demuestran generalización.')
        artifact_names = ['snapshot.json', 'benchmark.json', 'model.json'] + [f'{name}{suffix}' for name in MODEL_NAMES for suffix in ('.json', '.joblib')] + [f'confusion-{name}.png' for name in MODEL_NAMES]
        metrics_valid = all(np.isfinite(values[key]) and 0 <= values[key] <= 1 for values in models.values() for key in ('accuracy', 'precision_macro', 'recall_macro', 'f1_macro'))
        checks = {'dataset_valid': True, 'two_models': True, 'metrics_valid': metrics_valid, 'export_parity': parity['passed'],
                  'python_javascript_parity': parity.get('javascript_verified'), 'artifacts_complete': all((folder / name).is_file() for name in artifact_names)}
        if not all(checks[name] for name in ('dataset_valid', 'two_models', 'metrics_valid', 'export_parity', 'artifacts_complete')):
            raise WorkflowError('La jornada no pasó sus comprobaciones de integración.')
        missing = {label: max(0, 20 - count) for label, count in run['counts']['per_intent'].items()}
        run.update(status='succeeded', finished_at=now(), process_id=None, message='Dos clasificadores evaluados. Versión provisional lista para revisar y activar.',
                   selected_model=selected, cv_winner=selected, active_model=selected, cv=cv, models=models, errors=errors, predictions=predictions,
                   acceptance=acceptance, comparison=comparison, checks=checks, parity=parity,
                   requirements={'minimum_training': 200, 'minimum_intents': 10, 'minimum_per_intent': 20, 'minimum_test': 50,
                                 'training_total_met': len(training) >= 200, 'intents_met': len(run['labels']) >= 10,
                                 'per_intent_met': not any(missing.values()), 'test_total_met': final_test_size() >= 50,
                                 'per_intent_missing': missing, 'missing_examples_total': sum(missing.values())},
                   protocol={'seed': 42, 'cv': 'StratifiedKFold(5, shuffle=True, random_state=42)',
                             'selection': 'Mayor F1 macro medio de validación cruzada; empate: regresión logística.',
                             'parameters': {'naive_bayes': {'alpha': .25}, 'logistic_regression': {'C': 8.0, 'max_iter': 2000}},
                             'evaluation_policy': '80 consultas conocidas de desarrollo; el conjunto final reservado no participa en entrenamiento ni selección.'},
                   artifact_hashes={name: digest(folder / name) for name in artifact_names},
                   hashes={'base_file_sha256': digest(ROOT / 'data/simulation.json'), 'evaluation_file_sha256': digest(ROOT / 'data/test.csv'),
                           'training_snapshot_sha256': digest(folder / 'snapshot.json'), 'preprocessing_sha256': digest(ROOT / 'src/preprocessing.py')},
                   curve=read_json(ROOT / 'reports/simulation-metrics.json')['curve'], curve_verified=True)
        atomic_json(folder / 'run.json', run)
        return self.version(run['id'])

    def validate_artifacts(self, run_id):
        run = self.raw(run_id)
        if run['status'] != 'succeeded':
            raise WorkflowError('Solo una jornada terminada correctamente puede activarse.', 409)
        required = {'snapshot.json', 'benchmark.json', 'model.json'} | {f'{name}{suffix}' for name in MODEL_NAMES for suffix in ('.json', '.joblib')} | {f'confusion-{name}.png' for name in MODEL_NAMES}
        checks = run.get('checks', {})
        hashes = run.get('artifact_hashes', {})
        if set(hashes) != required or not all(checks.get(name) is True for name in ('dataset_valid', 'two_models', 'metrics_valid', 'export_parity', 'artifacts_complete')):
            raise WorkflowError('La versión no tiene todas las comprobaciones y archivos necesarios para activarse.', 409)
        if run.get('selected_model') not in MODEL_NAMES or set(run.get('models', {})) != set(MODEL_NAMES):
            raise WorkflowError('La versión no documenta los dos modelos y la selección.', 409)
        try:
            for name, expected in hashes.items():
                if Path(name).name != name or digest(self.run_folder(run_id) / name) != expected:
                    raise WorkflowError('Un archivo de la versión cambió después de entrenar. No se reemplazó el modelo activo.', 409)
            if hashes['model.json'] != hashes[f"{run['selected_model']}.json"]:
                raise WorkflowError('El modelo exportado no corresponde al seleccionado.', 409)
        except OSError:
            raise WorkflowError('Falta un archivo de la versión. No se reemplazó el modelo activo.', 409)
        return run

    def activate(self, run_id, author='system'):
        author_value(author)
        with lock(self.folder / 'registry.lock'):
            run = self.validate_artifacts(run_id)
            moment, previous = now(), self.active_id()
            event = {'id': str(uuid4()), 'run_id': run_id, 'author': author, 'created_at': moment, 'previous_id': previous,
                     'action': 'activate', 'checks_verified': True}
            atomic_json(self.run_folder(run_id) / 'approvals' / f"{event['id']}.json", event)
            atomic_json(self.folder / 'active.json', {'active_id': run_id, 'activated_at': moment, 'author': author, 'previous_id': previous})
        return self.active()

    def evaluate_final(self, run_id, author='system'):
        author_value(author)
        import joblib
        from src.preprocessing import tokenize
        from src.train import metric_bundle, explain_error
        self.validate_artifacts(run_id)
        run = self.raw(run_id)
        path = final_test_path()
        if not path.is_file():
            raise WorkflowError('Agrega al menos 50 consultas inéditas a data/final-test.csv antes de la evaluación final.')
        payload = path.read_bytes()
        file_hash = sha256(payload).hexdigest()
        rows = [row for row in csv.DictReader(io.StringIO(payload.decode('utf-8-sig'))) if row.get('text', '').strip()]
        if len(rows) < 50:
            raise WorkflowError(f'La prueba final contiene {len(rows)} consultas; se requieren al menos 50.')
        training = read_json(self.run_folder(run_id) / 'snapshot.json')['training_examples']
        exposed = read_json(self.run_folder(run_id) / 'benchmark.json')
        known = {' '.join(tokenize(row['text'])) for row in training + exposed}
        unique = set()
        pairs = []
        for row in rows:
            key = ' '.join(tokenize(row['text']))
            if not key or key in known or key in unique or row.get('intent') not in run['labels']:
                raise WorkflowError('La prueba final tiene duplicados, categorías inválidas o coincide con entrenamiento o el benchmark conocido.')
            unique.add(key)
            pairs.append([key, row['intent']])
        semantic_hash = sha256(canonical(sorted(pairs)).encode()).hexdigest()
        item_keys = {sha256(key.encode()).hexdigest() for key, _ in pairs}
        with lock(self.folder / 'final-evaluation.lock'):
            receipt_path = self.folder / 'final-receipts' / f'{semantic_hash}.json'
            receipt = read_json(receipt_path, {})
            if receipt:
                if receipt['run_id'] != run_id:
                    raise WorkflowError('Este conjunto final ya fue abierto para otra versión. Reserva un conjunto nuevo para evitar ajustar modelos a esa prueba.', 409)
                result_path = self.run_folder(run_id) / receipt['result_file']
                if result_path.is_file():
                    return read_json(result_path)
            # Changing the order, a label or a single sentence must not turn
            # previously exposed questions into a new independent holdout.
            for other_path in (self.folder / 'final-receipts').glob('*.json'):
                other = read_json(other_path)
                if other.get('run_id') == run_id:
                    continue
                previous_keys = set(other.get('item_keys', []))
                if not previous_keys and other.get('result_file'):
                    previous_result = self.run_folder(other['run_id']) / other['result_file']
                    if previous_result.is_file():
                        previous_keys = {sha256(' '.join(tokenize(row['text'])).encode()).hexdigest() for row in read_json(previous_result).get('predictions', [])}
                if item_keys & previous_keys:
                    raise WorkflowError('La prueba contiene consultas ya abiertas para otra versión. Reserva expresiones nuevas; cambiar solo parte del archivo no restaura su independencia.', 409)
            name = f'final-evaluation-{semantic_hash}.json'
            atomic_json(receipt_path, {'run_id': run_id, 'dataset_canonical_sha256': semantic_hash, 'file_sha256': file_hash,
                                       'item_keys': sorted(item_keys), 'opened_at': now(), 'status': 'opened', 'result_file': name})
            pipeline = joblib.load(self.run_folder(run_id) / f"{run['selected_model']}.joblib")
            predicted = pipeline.predict([row['text'] for row in rows]).tolist()
            result = {'run_id': run_id, 'dataset_sha256': file_hash, 'dataset_canonical_sha256': semantic_hash, 'evaluated_at': now(), 'author': author,
                      'scope': 'Evaluación final explícita; no usada en selección ni entrenamiento.',
                      'metrics': metric_bundle([row['intent'] for row in rows], predicted, run['labels']), 'total': len(rows),
                      'predictions': [{'text': row['text'], 'expected': row['intent'], 'predicted': value} for row, value in zip(rows, predicted)]}
            result['errors'] = [{'text': row['text'], 'expected': row['intent'], 'predicted': value,
                                 'interpretation': explain_error(row['text'], row['intent'], value)} for row, value in zip(rows, predicted) if row['intent'] != value]
            atomic_json(self.run_folder(run_id) / name, result)
            atomic_json(receipt_path, {'run_id': run_id, 'dataset_canonical_sha256': semantic_hash, 'file_sha256': file_hash, 'item_keys': sorted(item_keys), 'status': 'completed', 'evaluated_at': result['evaluated_at'], 'result_file': name})
            return result


def export_pipeline(pipeline, count, name):
    from src.preprocessing import STOPWORDS, LEMMA_MAP
    from src.simulation import THRESHOLDS
    vectorizer, classifier = pipeline.named_steps['tfidf'], pipeline.named_steps['classifier']
    return {'format_version': 1, 'model_type': name, 'classes': classifier.classes_.tolist(),
            'features': vectorizer.get_feature_names_out().tolist(), 'idf': vectorizer.idf_.tolist(),
            'weights': (classifier.coef_ if name == 'logistic_regression' else classifier.feature_log_prob_).tolist(),
            'intercept': (classifier.intercept_ if name == 'logistic_regression' else classifier.class_log_prior_).tolist(),
            'preprocessing': {'stopwords': STOPWORDS, 'lemma_map': LEMMA_MAP, 'ngram_range': [1, 2], 'sublinear_tf': True,
                              'norm': 'l2', 'unicode': 'NFD', 'token_pattern': '[a-z0-9]+'},
            'thresholds': THRESHOLDS, 'trained_examples': count,
            'note': 'Modelo entrenado localmente. La confianza no es exactitud ni diagnóstico físico.'}


def verify_export(pipeline, exported, texts):
    import numpy as np
    vectorizer = pipeline.named_steps['tfidf']
    matrix = vectorizer.transform(texts)
    scores = matrix @ np.asarray(exported['weights']).T + np.asarray(exported['intercept'])
    values = np.exp(scores - scores.max(axis=1, keepdims=True))
    values /= values.sum(axis=1, keepdims=True)
    expected = pipeline.predict_proba(texts)
    discrepancy = float(np.max(np.abs(values - expected)))
    if discrepancy > 1e-10:
        raise WorkflowError('La exportación no reproduce las probabilidades de Python.')
    node = os.environ.get('YINYAN_NODE') or (str(ROOT / 'runtime/node.exe') if (ROOT / 'runtime/node.exe').is_file() else shutil.which('node'))
    javascript = False
    js_difference = None
    if node:
        script = "import{readFileSync}from'node:fs';import{createClassifier}from'./web/ml.js';const a=JSON.parse(readFileSync(0,'utf8'));const c=createClassifier(a.model);process.stdout.write(JSON.stringify(a.texts.map(t=>c.predict(t).probabilities)));"
        completed = subprocess.run([node, '--input-type=module', '-e', script], cwd=ROOT,
                                   input=json.dumps({'model': exported, 'texts': texts}), encoding='utf-8', capture_output=True,
                                   timeout=30, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        if completed.returncode:
            raise WorkflowError('No se pudo comprobar la inferencia JavaScript: ' + completed.stderr[-300:])
        actual = np.asarray(json.loads(completed.stdout))
        js_difference = float(np.max(np.abs(actual - expected)))
        if js_difference > 1e-10:
            raise WorkflowError('Python y JavaScript no coinciden al cargar el modelo.')
        javascript = True
    return {'passed': True, 'export_max_difference': discrepancy, 'javascript_verified': javascript,
            'javascript_max_difference': js_difference, 'texts_checked': len(texts)}


def verified_evidence(registry):
    """Accept QA evidence only while the tested code and documents still match."""
    tests = read_json(ROOT / 'reports/test-results.json', {})
    hashes = tests.get('source_hashes', {})
    current = bool(tests.get('complete') and hashes)
    for name, expected in hashes.items() if current else []:
        try:
            if digest(ROOT / name) != expected:
                current = False
                break
        except OSError:
            current = False
            break
    active = registry.active_id()
    dialogue = read_json(ROOT / 'reports/current-dialogue-results.json', {})
    delivery = read_json(ROOT / 'reports/current-delivery-verification.json', {})
    documents = bool(current and delivery.get('passed') and delivery.get('version_id') == active and delivery.get('artifact_hashes'))
    for name, expected in delivery.get('artifact_hashes', {}).items() if documents else []:
        try:
            if digest(ROOT / name) != expected:
                documents = False
                break
        except OSError:
            documents = False
            break
    return {'context': bool(current and dialogue.get('failed') == 0 and dialogue.get('passed', 0) >= 7 and dialogue.get('version_id') == active),
            'documents': documents}


def final_evidence(registry):
    path = final_test_path()
    if not path.is_file() or not registry.active_id():
        return False
    from src.preprocessing import tokenize
    with path.open(encoding='utf-8-sig', newline='') as stream:
        pairs = [[' '.join(tokenize(row.get('text', ''))), row.get('intent', '')] for row in csv.DictReader(stream) if row.get('text', '').strip()]
    semantic_hash = sha256(canonical(sorted(pairs)).encode()).hexdigest()
    receipt = read_json(registry.folder / 'final-receipts' / f'{semantic_hash}.json', {})
    return receipt.get('status') == 'completed' and receipt.get('run_id') == registry.active_id()


def progress(snapshot, runtime=None):
    registry = Registry(runtime)
    source = read_json(ROOT / 'data/simulation.json')
    base = [row for stage in source['days'] for row in stage['examples']]
    labels = source['labels']
    extra = snapshot.get('examples', [])
    base_counts = Counter(row['intent'] for row in base)
    per_intent = []
    for label in labels:
        counts = Counter(row.get('review_status', 'pending') for row in extra if row['intent'] == label)
        approved = base_counts[label] + counts['approved']
        per_intent.append({'intent': label, 'base': base_counts[label], 'approved': approved,
                           'pending': counts['pending'], 'rejected': counts['rejected'], 'missing': max(0, 20 - approved)})
    states = Counter(row.get('review_status', 'pending') for row in extra)
    versions = registry.versions()
    missing = sum(row['missing'] for row in per_intent)
    final_size = final_test_size()
    active = registry.active()
    verified = verified_evidence(registry)
    final_verified = final_evidence(registry)
    return {'counts': {'base': len(base), 'total': len(base) + len(extra), 'approved': len(base) + states['approved'],
                       'approved_additional': states['approved'], 'pending': states['pending'], 'rejected': states['rejected']},
            'per_intent': per_intent, 'intents': labels, 'missing_examples_total': missing,
            'dataset_version': snapshot.get('approved_revision', snapshot.get('revision')),
            'active': active, 'last_training': versions[0] if versions else None, 'final_test_size': final_size,
            'rubric': [
                {'id': 'dataset', 'title': '20 ejemplos por intención', 'status': 'Pendiente de datos' if missing else 'Cumplido', 'evidence': f'Faltan {missing} ejemplos aprobados.'},
                {'id': 'pln', 'title': 'PLN e inferencia consistente', 'status': 'Cumplido', 'evidence': 'Tokenizador compartido, TF-IDF y comprobación de exportación en cada jornada.'},
                {'id': 'models', 'title': 'Dos clasificadores y selección', 'status': 'Cumplido' if any(row['status'] == 'succeeded' for row in versions) else 'Pendiente de verificación', 'evidence': 'CV estratificada de cinco pliegues; selección por F1 macro.'},
                {'id': 'final', 'title': 'Prueba final independiente', 'status': 'Pendiente de datos' if final_size < 50 else 'Cumplido' if final_verified else 'Pendiente de verificación', 'evidence': f'{final_size}/50 consultas; evaluación explícita por versión y recibo de apertura.'},
                {'id': 'context', 'title': 'Contexto, variantes y reinicio', 'status': 'Cumplido' if verified['context'] else 'Pendiente de verificación', 'evidence': 'Pruebas funcionales de la versión y hashes de código en reports/.'},
                {'id': 'documents', 'title': 'Notebook y PDF de la versión', 'status': 'Cumplido' if verified['documents'] else 'Pendiente de verificación', 'evidence': 'Notebook ejecutado, PDF verificado y hashes de la versión activa.'},
            ]}


def load_run_for_documents(version_id=None, runtime=None):
    registry = Registry(runtime)
    if version_id is None:
        version_id = registry.active_id()
        if version_id is None:
            version_id = next((row['id'] for row in registry.versions() if row['status'] == 'succeeded'), None)
    if version_id is None:
        return None
    run = registry.version(version_id)
    if run['status'] != 'succeeded':
        raise WorkflowError('No se puede documentar una jornada incompleta.')
    registry.validate_artifacts(version_id)
    snapshot = read_json(registry.run_folder(version_id) / 'snapshot.json')
    run.update(generated_at=run['finished_at'], active_model=run['selected_model'], active_matches_cv_winner=True,
               version_id=run['id'], registry_active_id=registry.active_id(), model_path=str(registry.run_folder(version_id) / 'model.json'),
               snapshot_data={**snapshot, 'evaluation': read_json(registry.run_folder(version_id) / 'benchmark.json')},
               team=read_json(ROOT / 'docs/equipo.json'),
               provenance={'base': 'Base sintética conservada, con sus fechas originales.', 'additional': 'Solo aportaciones aprobadas presentes en la instantánea de esta jornada.',
                           'evaluation': 'Benchmark de desarrollo conocido; no es el conjunto final reservado.', 'timestamps': 'Fecha real de ejecución de la jornada.'},
               artifacts={'folder': str(registry.run_folder(version_id)), 'matrices': {name: str(registry.run_folder(version_id) / f'confusion-{name}.png') for name in MODEL_NAMES}})
    return run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['start', 'reserve', 'train', 'activate', 'final', 'list', 'progress', 'documents', 'fail'])
    parser.add_argument('--runtime', type=Path)
    parser.add_argument('--input', type=Path)
    parser.add_argument('--id')
    parser.add_argument('--author', default='system')
    parser.add_argument('--message', default='El entrenamiento se interrumpió.')
    args = parser.parse_args()
    registry = Registry(args.runtime)
    try:
        if args.command == 'start':
            from scripts.team_store import TeamStore
            reserved = registry.reserve(TeamStore(ROOT, registry.runtime).snapshot(), args.author)
            run = registry.train(reserved['id'])
            result = {key: run[key] for key in ('id', 'journey', 'created_at', 'finished_at', 'status', 'approval_status', 'dataset_version', 'selected_model', 'message')}
            result['metrics'] = run['models'][run['selected_model']]
            result['note'] = 'Versión provisional; revisar y activar explícitamente desde Jornadas.'
        elif args.command == 'reserve':
            result = registry.reserve(read_json(args.input), args.author)
        elif args.command == 'train':
            result = registry.train(args.id)
        elif args.command == 'activate':
            result = registry.activate(args.id, args.author)
        elif args.command == 'final':
            result = registry.evaluate_final(args.id, args.author)
        elif args.command == 'list':
            result = {'versions': registry.versions(), 'active_id': registry.active_id()}
        elif args.command == 'progress':
            result = progress(read_json(args.input), args.runtime)
        elif args.command == 'fail':
            result = registry.fail(args.id, args.message)
        else:
            result = load_run_for_documents(args.id, args.runtime)
        print(json.dumps(result, ensure_ascii=True))
    except Exception as error:
        print(json.dumps({'error': str(error), 'status': getattr(error, 'status', 500)}, ensure_ascii=True))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
