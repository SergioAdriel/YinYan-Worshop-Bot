"""Bitácora compartible por Git; cada aportación es un archivo inmutable."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import unicodedata
import uuid

INTENTS = set('saludo despedida ayuda encendido carga temperatura rendimiento conexion pantalla sonido almacenamiento software controles liquidos presupuesto contacto'.split())
AUTHORS = {'alumno-a', 'alumno-b'}
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
        raise ApiError('Elige uno de los dos estudiantes.')
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
        self.runtime = Path(runtime)
        default = self.runtime / 'team-records' if os.environ.get('YINYAN_DATA_DIR') else Path(project) / 'data/team'
        self.folder = Path(os.environ.get('YINYAN_TEAM_DIR', str(default))).resolve()
        self.legacy = self.runtime / 'student-examples.json'
        self.marker = self.runtime / 'migration-complete.json'

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
        return self.folder / author / kind / (uuid_id(row_id) + '.json')

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

    def snapshot(self):
        self.migrate()
        deleted = {row['example_id'] for row in self.records('deletions')}
        examples = []
        for record in self.records('examples'):
            if record['id'] in deleted:
                continue
            row = {name: record[name] for name in ('id', 'text', 'intent', 'author', 'created_at', 'timezone', 'timestamp_kind', 'source')}
            if record.get('source_query_id'):
                row['source_query_id'] = record['source_query_id']
            examples.append(row)
        return {'examples': examples, 'revision': hashlib.sha256(compact(examples).encode('utf-8')).hexdigest()}

    def create_example(self, data, source='manual', source_query_id=None):
        clean = clean_example(data)
        examples = self.snapshot()['examples']
        if any(key(row['text']) == key(clean['text']) for row in examples):
            raise ApiError('Esa consulta ya existe. Revisa su categoría en la lista.', 409)
        if len(examples) >= 500:
            raise ApiError('Puedes guardar hasta 500 ejemplos propios.')
        row = {'id': str(uuid.uuid4()), **clean, 'created_at': now(), 'timezone': TIMEZONE,
               'timestamp_kind': 'recorded', 'source': source}
        if source_query_id:
            row['source_query_id'] = source_query_id
        self.append(self.path(row['author'], 'examples', row['id']), row)
        return self.snapshot()

    def import_examples(self, data):
        if not isinstance(data, dict) or not isinstance(data.get('examples'), list) or len(data['examples']) > 500:
            raise ApiError('Importa un JSON con examples y un máximo de 500 ejemplos.')
        rows = [clean_example(row) for row in data['examples']]
        existing = self.snapshot()['examples']
        known = {key(row['text']): row['intent'] for row in existing}
        additions = []
        for row in rows:
            normalized = key(row['text'])
            if normalized in known:
                if known[normalized] != row['intent']:
                    raise ApiError('Una consulta importada tiene dos categorías distintas. Corrígela antes de importar.', 409)
                continue
            known[normalized] = row['intent']
            additions.append(row)
        if len(existing) + len(additions) > 500:
            raise ApiError('Puedes guardar hasta 500 ejemplos propios.')
        for row in additions:
            self.create_example(row)
        return self.snapshot()

    def delete_example(self, row_id, data=None):
        row_id = uuid_id(row_id)
        example = next((row for row in self.snapshot()['examples'] if row['id'] == row_id), None)
        if not example:
            raise ApiError('No se encontró ese ejemplo.', 404)
        if data is not None and not isinstance(data, dict):
            raise ApiError('El contenido debe ser un objeto.')
        author = clean_author((data or {}).get('author', example['author']))
        row = {'id': str(uuid.uuid4()), 'example_id': row_id, 'author': author,
               'created_at': now(), 'timezone': TIMEZONE}
        self.append(self.path(author, 'deletions', row['id']), row)
        return self.snapshot()

    @staticmethod
    def clean_query(data):
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
        if not isinstance(model, dict) or model.get('kind') not in ('simulation', 'custom'):
            raise ApiError('Indica el modelo utilizado en la consulta.')
        selected = {'kind': model['kind']}
        if selected['kind'] == 'simulation':
            day = model.get('day')
            if isinstance(day, bool) or not isinstance(day, int) or not 1 <= day <= 15:
                raise ApiError('El día del modelo debe estar entre 1 y 15.')
            selected['day'] = day
        elif model.get('revision') is not None:
            selected['revision'] = clean_text(model['revision'], 1, 128)
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
            row = {**record, 'reviewed': record['id'] in reviewed}
            if row['reviewed']:
                row['example_id'] = reviewed[record['id']]
            queries.append(row)
        return {'queries': queries, 'timezone': TIMEZONE}

    def create_query(self, data):
        clean = self.clean_query(data)
        row_id = uuid_id(data['id']) if 'id' in data else str(uuid.uuid4())
        existing = next((row for row in self.records('queries') if row['id'] == row_id), None)
        if existing:
            if self.clean_query(existing) != clean:
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
