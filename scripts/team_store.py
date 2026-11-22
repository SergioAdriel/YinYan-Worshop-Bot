"""Bitácora compartible por Git; cada aportación es un archivo inmutable."""
from __future__ import annotations

from datetime import datetime, timezone
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import unicodedata
import uuid

INTENTS = set('saludo despedida ayuda encendido carga temperatura rendimiento conexion pantalla sonido almacenamiento software controles liquidos presupuesto contacto'.split())
AUTHORS = {'alumno-a', 'alumno-b', 'sergio', 'raynier'}
REVIEW_STATES = ('pending', 'approved', 'rejected')
MAX_EXAMPLES = 2000
TIMEZONE = 'America/Mexico_City'
CONTROL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f]')


class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def key(text):
    text = ''.join(c for c in unicodedata.normalize('NFD', text) if not unicodedata.combining(c))
    return ' '.join(text.lower().split())


def uuid_id(value):
    if not isinstance(value, str):
        raise ApiError('El identificador debe ser un UUID válido.')
    try:
        parsed = uuid.UUID(value)
    except (ValueError, AttributeError):
        raise ApiError('El identificador debe ser un UUID válido.')
    if str(parsed) != value.lower():
        raise ApiError('El identificador debe ser un UUID válido.')
    return str(parsed)


def clean_text(value, minimum=3, maximum=1200):
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum or CONTROL.search(value):
        raise ApiError(f'Escribe un texto de entre {minimum} y {maximum} caracteres.')
    return value.strip()


def clean_author(value):
    if not isinstance(value, str) or value not in AUTHORS:
        raise ApiError('Elige uno de los cuatro responsables del equipo.')
    return value


def clean_intent(value):
    if not isinstance(value, str) or value not in INTENTS:
        raise ApiError('Elige una categoría válida.')
    return value


def clean_example(row):
    if not isinstance(row, dict):
        raise ApiError('Cada ejemplo debe ser un objeto.')
    return {'text': clean_text(row.get('text')), 'intent': clean_intent(row.get('intent')),
            'author': clean_author(row.get('author'))}


class TeamStore:
    def __init__(self, project, runtime):
        self.project = Path(project)
        self.runtime = Path(runtime)
        default = self.runtime / 'team-records' if os.environ.get('YINYAN_DATA_DIR') else Path(project) / 'data/team'
        self.folder = Path(os.environ.get('YINYAN_TEAM_DIR', str(default))).resolve()
        self.legacy = self.runtime / 'student-examples.json'
        self.marker = self.runtime / 'migration-complete.json'
        self._tokenizer = None

    def tokenizer(self):
        if self._tokenizer is None:
            source = self.reference_source()
            model = source['model']
            stopwords = set(model['preprocessing']['stopwords'])
            lemmas = model['preprocessing']['lemma_map']
            def prepared(text):
                normalized = ''.join(character for character in unicodedata.normalize('NFD', str(text))
                                     if not '\u0300' <= character <= '\u036f').lower()
                return ' '.join(lemmas.get(word, word) for word in re.findall(r'[a-z0-9]+', normalized)
                                if word not in stopwords)
            self._tokenizer = prepared
        return self._tokenizer

    def protected_texts(self):
        prepared = self.tokenizer()
        source = self.reference_source()
        base = {prepared(row['text']) for row in source['examples']}
        evaluation = set()
        paths = {self.project / 'data/test.csv',
                 Path(os.environ.get('YINYAN_FINAL_TEST_FILE', str(self.project / 'data/final-test.csv'))).resolve()}
        for path in paths:
            if not path.is_file():
                continue
            with path.open(encoding='utf-8-sig', newline='') as stream:
                for row in csv.DictReader(stream):
                    if row.get('text', '').strip():
                        evaluation.add(prepared(row['text']))
        return prepared, base, evaluation

    @staticmethod
    def append(path, value):
        """Publica el JSON completo sin sobrescribir otro registro concurrente."""
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name('.' + path.name + '.' + str(uuid.uuid4()) + '.tmp')
        try:
            with temporary.open('x', encoding='utf-8', newline='\n') as stream:
                stream.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
                stream.flush()
                os.fsync(stream.fileno())
            os.link(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    def path(self, author, kind, row_id):
        return self.folder / clean_author(author) / kind / (uuid_id(row_id) + '.json')

    def records(self, kind):
        rows = []
        for author in sorted(AUTHORS):
            folder = self.folder / author / kind
            if not folder.exists():
                continue
            for path in sorted(folder.glob('*.json')):
                try:
                    row = json.loads(path.read_text(encoding='utf-8'))
                    if not isinstance(row, dict) or row.get('author') != author or uuid_id(row.get('id')) != path.stem:
                        raise ValueError('Registro inválido')
                except (ValueError, UnicodeError, ApiError):
                    raise ApiError(f'Hay un registro dañado en data/team: {path.name}. Conserva una copia y revísalo.', 500)
                rows.append(row)
        return sorted(rows, key=lambda row: (row.get('created_at') or '', row['id']))

    def migrate(self):
        if self.marker.is_file():
            return
        try:
            payload = json.loads(self.legacy.read_text(encoding='utf-8'))
            if not isinstance(payload, dict) or not isinstance(payload.get('examples'), list):
                raise ValueError('Formato legado inválido')
        except FileNotFoundError:
            payload = {'examples': []}
        except (ValueError, UnicodeError):
            raise ApiError('El archivo legado student-examples.json está dañado. Conserva una copia y revísalo.', 500)
        for old in payload['examples']:
            try:
                cleaned = clean_example(old)
                old_id = old.get('id')
                try:
                    row_id = uuid_id(old_id)
                except ApiError:
                    seed = str(old_id) if old_id is not None else hashlib.sha256(compact(cleaned).encode('utf-8')).hexdigest()
                    digest = hashlib.sha256(('yinyan-legacy:' + seed).encode('utf-8')).hexdigest()
                    row_id = str(uuid.UUID(digest[:32]))
                row = {'id': row_id, **cleaned, 'created_at': None, 'timezone': TIMEZONE,
                       'timestamp_kind': 'unknown', 'source': 'manual'}
                try:
                    self.append(self.path(row['author'], 'examples', row_id), row)
                except FileExistsError:
                    pass
            except ApiError:
                raise ApiError('Un ejemplo legado es inválido. Conserva student-examples.json y revísalo.', 500)
        try:
            self.append(self.marker, {'completed_at': now(), 'legacy_examples': len(payload['examples'])})
        except FileExistsError:
            pass

    @staticmethod
    def projection(row):
        return {name: row[name] for name in ('id', 'text', 'intent', 'author', 'review_status', 'record_version', 'review_conflict')}

    @classmethod
    def revision_for(cls, rows):
        return hashlib.sha256(compact([cls.projection(row) for row in sorted(rows, key=lambda row: row['id'])]).encode('utf-8')).hexdigest()

    @staticmethod
    def materialize(original, events):
        cleaned = clean_example(original)
        row = {'id': original['id'], **cleaned, 'created_at': original.get('created_at'),
               'timezone': TIMEZONE, 'timestamp_kind': original.get('timestamp_kind') or 'unknown',
               'source': original.get('source') or 'manual'}
        if original.get('source_query_id'):
            row['source_query_id'] = original['source_query_id']
        row['review_status'] = original.get('review_status') if original.get('review_status') in REVIEW_STATES else 'pending'
        row.update(reviewed_at=None, reviewed_by=None, updated_at=row['created_at'], updated_by=row['author'],
                   review_conflict=False, event_sequence=0)
        versions = [row['id']]
        row['record_version'] = hashlib.sha256(compact(versions).encode('utf-8')).hexdigest()
        related = sorted((event for event in events if event.get('example_id') == row['id']),
                         key=lambda event: (event.get('sequence') or 0, event['id']))
        for event in related:
            matches = event.get('parent_version') == row['record_version']
            if matches and event.get('action') == 'edit':
                row.update(text=clean_text(event.get('text')), intent=clean_intent(event.get('intent')),
                           review_status='pending', reviewed_at=None, reviewed_by=None, review_conflict=False)
            elif matches and event.get('action') == 'review' and event.get('review_status') in REVIEW_STATES:
                row.update(review_status=event['review_status'], reviewed_at=event['created_at'], reviewed_by=event['author'],
                           review_note=event.get('note') or '', review_conflict=False)
            else:
                row.update(review_status='pending', review_conflict=True)
            row.update(updated_at=event['created_at'], updated_by=event['author'],
                       event_sequence=max(row['event_sequence'], event.get('sequence') or 0))
            versions.append(event['id'])
            row['record_version'] = hashlib.sha256(compact(versions).encode('utf-8')).hexdigest()
        return row

    def snapshot(self):
        self.migrate()
        deleted = {row['example_id'] for row in self.records('deletions')}
        events = self.records('events')
        examples = [self.materialize(record, events) for record in self.records('examples') if record['id'] not in deleted]
        # Conflictos de incorporación concurrente nunca se incorporan como aprobados.
        prepared = self.tokenizer()
        groups = {}
        for row in examples:
            groups.setdefault(prepared(row['text']), []).append(row)
        for group in groups.values():
            if len(group) > 1:
                for row in group:
                    row.update(review_status='pending', review_conflict=True)
        revision = self.revision_for(examples)
        for row in examples:
            row['dataset_version'] = revision
        approved = [row for row in examples if row['review_status'] == 'approved']
        return {'examples': examples, 'revision': revision, 'dataset_version': revision,
                'approved_examples': approved, 'approved_revision': self.revision_for(approved),
                'counts': {status: sum(row['review_status'] == status for row in examples) for status in REVIEW_STATES}}

    def ensure_unique(self, cleaned, examples, excluding=None):
        prepared, base, evaluation = self.protected_texts()
        value = prepared(cleaned['text'])
        if not value:
            raise ApiError('Escribe una consulta con palabras útiles, no solo signos o palabras vacías.')
        if value in evaluation:
            raise ApiError('Esa expresión pertenece al conjunto de evaluación y no puede incorporarse al entrenamiento.', 409)
        if value in base:
            raise ApiError('Esa expresión ya está en la base inicial. Agrega una redacción diferente y pertinente.', 409)
        if any(row['id'] != excluding and prepared(row['text']) == value for row in examples):
            raise ApiError('Esa consulta ya existe tras preparar el texto. Revisa su categoría en la lista.', 409)

    def create_example(self, data, source='manual', source_query_id=None):
        clean = clean_example(data)
        examples = self.snapshot()['examples']
        self.ensure_unique(clean, examples)
        if len(examples) >= MAX_EXAMPLES:
            raise ApiError(f'Puedes guardar hasta {MAX_EXAMPLES} ejemplos propios.')
        row = {'id': str(uuid.uuid4()), **clean, 'created_at': now(), 'timezone': TIMEZONE,
               'timestamp_kind': 'recorded', 'source': source, 'review_status': 'pending'}
        if source_query_id:
            row['source_query_id'] = source_query_id
        row['dataset_version'] = self.revision_for([*examples, self.materialize(row, [])])
        self.append(self.path(row['author'], 'examples', row['id']), row)
        return self.snapshot()

    def import_examples(self, data):
        if not isinstance(data, dict) or not isinstance(data.get('examples'), list) or len(data['examples']) > MAX_EXAMPLES:
            raise ApiError(f'Importa un JSON con examples y un máximo de {MAX_EXAMPLES} ejemplos.')
        rows = [clean_example(row) for row in data['examples']]
        existing = self.snapshot()['examples']
        prepared = self.tokenizer()
        known = {prepared(row['text']): row['intent'] for row in existing}
        additions = []
        for row in rows:
            normalized = prepared(row['text'])
            if normalized in known:
                if known[normalized] != row['intent']:
                    raise ApiError('Una consulta importada tiene dos categorías distintas. Corrígela antes de importar.', 409)
                continue
            self.ensure_unique(row, existing)
            known[normalized] = row['intent']
            additions.append(row)
        if len(existing) + len(additions) > MAX_EXAMPLES:
            raise ApiError(f'Puedes guardar hasta {MAX_EXAMPLES} ejemplos propios.')
        for row in additions:
            self.create_example(row)
        return self.snapshot()

    def delete_example(self, row_id, data=None):
        row_id = uuid_id(row_id)
        example = next((row for row in self.snapshot()['examples'] if row['id'] == row_id), None)
        if not example:
            raise ApiError('No se encontró ese ejemplo.', 404)
        if example['review_status'] != 'pending':
            raise ApiError('Reabre el ejemplo como pendiente antes de eliminarlo.', 409)
        if data is not None and not isinstance(data, dict):
            raise ApiError('El contenido debe ser un objeto.')
        if (data or {}).get('record_version') is not None and data['record_version'] != example['record_version']:
            raise ApiError('El ejemplo cambió en otra sesión. Actualiza la lista antes de eliminarlo.', 409)
        author = clean_author((data or {}).get('author', example['author']))
        row = {'id': str(uuid.uuid4()), 'example_id': row_id, 'author': author,
               'created_at': now(), 'timezone': TIMEZONE}
        self.append(self.path(author, 'deletions', row['id']), row)
        return self.snapshot()

    def edit_example(self, row_id, data):
        row_id = uuid_id(row_id)
        saved = self.snapshot()
        example = next((row for row in saved['examples'] if row['id'] == row_id), None)
        if not example:
            raise ApiError('No se encontró ese ejemplo.', 404)
        if example['review_status'] != 'pending':
            raise ApiError('Reabre el ejemplo como pendiente antes de editarlo.', 409)
        cleaned = clean_example(data)
        if data.get('record_version') is not None and data['record_version'] != example['record_version']:
            raise ApiError('El ejemplo cambió en otra sesión. Actualiza la lista y revisa sus datos.', 409)
        self.ensure_unique(cleaned, saved['examples'], row_id)
        event = {'id': str(uuid.uuid4()), 'example_id': row_id, 'author': cleaned['author'],
                 'action': 'edit', 'text': cleaned['text'], 'intent': cleaned['intent'],
                 'parent_version': example['record_version'], 'sequence': example['event_sequence'] + 1,
                 'created_at': now(), 'timezone': TIMEZONE, 'timestamp_kind': 'recorded',
                 'dataset_version_before': saved['revision']}
        self.append(self.path(event['author'], 'events', event['id']), event)
        return self.snapshot()

    def review_example(self, row_id, data):
        row_id = uuid_id(row_id)
        if not isinstance(data, dict):
            raise ApiError('La revisión debe ser un objeto.')
        if data.get('review_status') not in REVIEW_STATES:
            raise ApiError('Elige pendiente, aprobado o rechazado.')
        saved = self.snapshot()
        example = next((row for row in saved['examples'] if row['id'] == row_id), None)
        if not example:
            raise ApiError('No se encontró ese ejemplo.', 404)
        author = clean_author(data.get('author'))
        if data.get('record_version') is not None and data['record_version'] != example['record_version']:
            raise ApiError('El ejemplo cambió en otra sesión. Actualiza la lista y revisa sus datos.', 409)
        if data['review_status'] == 'approved':
            self.ensure_unique(example, saved['examples'], row_id)
        note = '' if data.get('note') is None else clean_text(data['note'], 0, 600)
        event = {'id': str(uuid.uuid4()), 'example_id': row_id, 'author': author, 'action': 'review',
                 'review_status': data['review_status'], 'note': note, 'parent_version': example['record_version'],
                 'sequence': example['event_sequence'] + 1, 'created_at': now(), 'timezone': TIMEZONE,
                 'timestamp_kind': 'recorded', 'dataset_version_before': saved['revision']}
        self.append(self.path(author, 'events', event['id']), event)
        return self.snapshot()

    def reference_source(self):
        catalog = json.loads((self.project / 'data/training/training_history.json').read_text(encoding='utf-8'))
        folder = self.project / 'data/training/runs' / catalog['references']['base_id']
        snapshot = json.loads((folder / 'snapshot.json').read_text(encoding='utf-8'))
        model = json.loads((folder / 'model.json').read_text(encoding='utf-8'))
        return {'examples': snapshot.get('training_examples', snapshot.get('base_examples', [])), 'model': model}

    def stored_query_model(self, model):
        if isinstance(model, dict) and model.get('kind') == 'version':
            return {'kind': 'version', 'version_id': uuid_id(model.get('version_id'))}
        day = model.get('day') if isinstance(model, dict) else None
        if isinstance(model, dict) and model.get('kind') == 'simulation' and isinstance(day, int) and not isinstance(day, bool) and 1 <= day <= 15:
            catalog = json.loads((self.project / 'data/training/training_history.json').read_text(encoding='utf-8'))
            mapped = catalog['references']['stages'].get(str(day))
            if mapped:
                return {'kind': 'version', 'version_id': uuid_id(mapped)}
        raise ApiError('Una consulta anterior no tiene una versión equivalente verificable. Conserva el registro original y revisa la migración.', 500)

    def clean_query(self, data):
        if not isinstance(data, dict):
            raise ApiError('La consulta debe ser un objeto.')
        session_id = clean_text(data.get('session_id'), 1, 80)
        author = clean_author(data.get('author'))
        intent = data.get('intent')
        if intent is not None and intent not in ('aclaracion', 'desconocida', 'seguridad'):
            clean_intent(intent)
        if not isinstance(data.get('accepted'), bool):
            raise ApiError('La consulta debe indicar si la predicción fue aceptada.')
        model = data.get('model')
        if isinstance(model, dict) and model.get('kind') == 'version':
            selected = {'kind': 'version', 'version_id': uuid_id(model.get('version_id'))}
        elif isinstance(model, dict) and model.get('kind') == 'simulation' and isinstance(model.get('day'), int) and not isinstance(model['day'], bool) and 1 <= model['day'] <= 15:
            selected = self.stored_query_model(model)
        elif isinstance(model, dict) and model.get('kind') == 'custom':
            raise ApiError('La consulta pendiente pertenece a un modelo anterior que no se puede identificar. La copia se conserva en este navegador.')
        else:
            raise ApiError('Indica la versión de entrenamiento utilizada en la consulta.')
        row = {'session_id': session_id, 'author': author, 'text': clean_text(data.get('text'), 1, 1200),
               'response': clean_text(data.get('response'), 1, 6000), 'intent': intent,
               'accepted': data['accepted'], 'model': selected, 'resolution': None}
        if data.get('resolution') is not None:
            row['resolution'] = clean_text(data['resolution'], 1, 80)
        return row

    def queries(self):
        examples = self.snapshot()['examples']
        reviewed = {row['source_query_id']: row['id'] for row in examples if row.get('source_query_id')}
        queries = []
        for record in self.records('queries'):
            row = {**record, 'model': self.stored_query_model(record.get('model')), 'reviewed': record['id'] in reviewed}
            if row['reviewed']:
                row['example_id'] = reviewed[record['id']]
            queries.append(row)
        return {'queries': queries, 'timezone': TIMEZONE}

    def create_query(self, data):
        clean = self.clean_query(data)
        row_id = uuid_id(data['id']) if 'id' in data else str(uuid.uuid4())
        existing = next((row for row in self.records('queries') if row['id'] == row_id), None)
        if existing:
            if self.clean_query({**existing, 'model': self.stored_query_model(existing.get('model'))}) != clean:
                raise ApiError('Ese identificador ya pertenece a otra consulta.', 409)
            return 200, {'query': next(row for row in self.queries()['queries'] if row['id'] == row_id)}
        row = {'id': row_id, **clean, 'created_at': now(), 'timezone': TIMEZONE, 'timestamp_kind': 'recorded'}
        try:
            self.append(self.path(row['author'], 'queries', row_id), row)
        except FileExistsError:
            # Otro proceso pudo publicar el mismo reintento mientras se leía.
            # La segunda lectura compara el contenido y devuelve 200 o 409.
            return self.create_query(data)
        return 201, {'query': {**row, 'reviewed': False}}

    def review_query(self, query_id, data):
        query_id = uuid_id(query_id)
        query = next((row for row in self.records('queries') if row['id'] == query_id), None)
        if not query:
            raise ApiError('No se encontró esa consulta.', 404)
        if not isinstance(data, dict):
            raise ApiError('La revisión debe ser un objeto.')
        reviewed_text = query['text'] if data.get('text') is None else data['text']
        row = clean_example({'text': reviewed_text, 'intent': data.get('intent'), 'author': data.get('author')})
        snapshot = self.snapshot()
        if any(example.get('source_query_id') == query_id for example in snapshot['examples']):
            return 200, snapshot
        return 201, self.create_example(row, source='review', source_query_id=query_id)
