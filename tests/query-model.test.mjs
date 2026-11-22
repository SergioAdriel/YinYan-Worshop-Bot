import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {createTeamStore} from '../scripts/team-store.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.YINYAN_PYTHON || resolve(root, 'runtime/python/python.exe');
const execute = promisify(execFile);
const catalog = JSON.parse(await readFile(resolve(root, 'data/training/training_history.json'), 'utf8'));
const originalDate = '2026-11-18T16:32:11.349Z';

function query(model, extra = {}) {
  return {id: randomUUID(), session_id: 'sesion-con-modelo-identificado', author: 'alumno-a',
    text: 'Mi celular no carga cuando conecto su cable',
    response: '¿Aparece el indicador de carga al conectar un cable compatible?',
    intent: 'carga', accepted: true, resolution: null, model, ...extra};
}

function nodeStore(workspace, team) {
  const keys = ['YINYAN_DATA_DIR', 'YINYAN_TEAM_DIR'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {YINYAN_DATA_DIR: workspace, YINYAN_TEAM_DIR: team});
  try {return createTeamStore({project: root, runtime: workspace});}
  finally {
    for (const key of keys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
}

const pythonScript = `import json,sys
from pathlib import Path
from scripts.team_store import TeamStore,ApiError
store=TeamStore(Path.cwd(),Path(sys.argv[1]))
action=sys.argv[2]
payload=json.loads(sys.argv[3])
try:
    if action=='create': status,value=store.create_query(payload)
    elif action=='queries': status,value=200,store.queries()
    else: raise ValueError(action)
    result={'status':status,'value':value}
except ApiError as error:
    result={'status':error.status,'error':str(error)}
print(json.dumps(result,ensure_ascii=True))`;

async function fixture(backend, work) {
  const workspace = await mkdtemp(join(tmpdir(), 'yinyan-query-model-'));
  const team = join(workspace, 'team');
  const store = backend === 'Node' ? nodeStore(workspace, team) : null;
  async function call(action, payload = {}) {
    if (store) {
      try {
        return action === 'create' ? await store.createQuery(payload)
          : {status: 200, value: await store.queries()};
      } catch (error) {
        if (error.status) return {status: error.status, error: error.message};
        throw error;
      }
    }
    const {stdout} = await execute(python, ['-B', '-c', pythonScript, workspace, action, JSON.stringify(payload)], {
      cwd: root, windowsHide: true, maxBuffer: 1024 * 1024,
      env: {...process.env, PYTHONUTF8: '1', YINYAN_DATA_DIR: workspace, YINYAN_TEAM_DIR: team},
    });
    return JSON.parse(stdout.trim());
  }
  const recordPath = row => join(team, row.author, 'queries', row.id + '.json');
  try {await work({call, recordPath});}
  finally {
    const target = await realpath(workspace);
    assert.equal(dirname(target), await realpath(tmpdir()));
    assert.ok(basename(target).startsWith('yinyan-query-model-'));
    assert.equal(resolve(target), resolve(workspace));
    await rm(target, {recursive: true, force: true, maxRetries: 3, retryDelay: 100});
  }
}

for (const backend of ['Node', 'Python']) {
  test(`${backend}: consultas de etapas 1, 8 y 15 conservan su versión y son idempotentes`, async () => fixture(backend, async ({call, recordPath}) => {
    for (const day of [1, 8, 15]) {
      const input = query({kind: 'simulation', day});
      const expectedModel = {kind: 'version', version_id: catalog.references.stages[String(day)]};
      const created = await call('create', input);
      assert.equal(created.status, 201, JSON.stringify(created));
      const row = created.value.query;
      assert.deepEqual(row.model, expectedModel);
      assert.equal(row.text, input.text);
      assert.equal(row.response, input.response);
      assert.ok(Number.isFinite(Date.parse(row.created_at)));
      const bytes = await readFile(recordPath(row));
      const repeated = await call('create', input);
      assert.equal(repeated.status, 200, JSON.stringify(repeated));
      assert.deepEqual(repeated.value.query, row);
      const canonicalRetry = await call('create', {...input, model: expectedModel});
      assert.equal(canonicalRetry.status, 200, JSON.stringify(canonicalRetry));
      assert.deepEqual(canonicalRetry.value.query, row);
      const conflict = await call('create', {...input, model: {kind: 'simulation', day: day === 1 ? 8 : 1}});
      assert.equal(conflict.status, 409, JSON.stringify(conflict));
      assert.deepEqual(await readFile(recordPath(row)), bytes, 'Un reintento nunca reescribe la evidencia.');
    }
    assert.equal((await call('queries')).value.queries.length, 3);
  }));

  test(`${backend}: un descriptor desconocido no se atribuye al modelo activo ni deja registros`, async () => fixture(backend, async ({call}) => {
    const invalid = [
      undefined, null, {}, [], 'simulation',
      {kind: 'custom', day: 15}, {kind: 'custom', revision: 'revision-sin-version-verificable'},
      {kind: 'inventado', day: 15}, {day: 15},
      {kind: 'simulation'}, {kind: 'simulation', day: 0}, {kind: 'simulation', day: 16},
      {kind: 'simulation', day: 8.5}, {kind: 'simulation', day: '15'}, {kind: 'simulation', day: true},
      {kind: 'version', version_id: ''}, {kind: 'version', version_id: 'jornada-sin-uuid'},
    ];
    for (const model of invalid) {
      const result = await call('create', query(model));
      assert.equal(result.status, 400, JSON.stringify({model, result}));
    }
    const stored = await call('queries');
    assert.equal(stored.status, 200, JSON.stringify(stored));
    assert.deepEqual(stored.value.queries, []);
  }));

  test(`${backend}: leer y reintentar una consulta antigua conserva su archivo y fecha originales`, async () => fixture(backend, async ({call, recordPath}) => {
    const input = query({kind: 'simulation', day: 8});
    const legacy = {...input, created_at: originalDate, timezone: 'America/Mexico_City', timestamp_kind: 'recorded'};
    const original = Buffer.from(JSON.stringify(legacy, null, 2) + '\n');
    await mkdir(dirname(recordPath(legacy)), {recursive: true});
    await writeFile(recordPath(legacy), original);
    const expected = {...legacy, model: {kind: 'version', version_id: catalog.references.stages['8']}, reviewed: false};
    const listed = await call('queries');
    assert.equal(listed.status, 200, JSON.stringify(listed));
    assert.deepEqual(listed.value.queries, [expected]);
    const retry = await call('create', input);
    assert.equal(retry.status, 200, JSON.stringify(retry));
    assert.deepEqual(retry.value.query, expected);
    const canonicalRetry = await call('create', {...input, model: expected.model});
    assert.equal(canonicalRetry.status, 200, JSON.stringify(canonicalRetry));
    assert.equal(canonicalRetry.value.query.created_at, originalDate);
    assert.deepEqual(await readFile(recordPath(legacy)), original);
  }));

  test(`${backend}: una versión escrita con mayúsculas se guarda con su UUID canónico`, async () => fixture(backend, async ({call}) => {
    const id = catalog.references.stages['15'];
    const input = query({kind: 'version', version_id: id.toUpperCase()});
    const created = await call('create', input);
    assert.equal(created.status, 201, JSON.stringify(created));
    assert.deepEqual(created.value.query.model, {kind: 'version', version_id: id});
    const repeated = await call('create', {...input, model: {kind: 'version', version_id: id}});
    assert.equal(repeated.status, 200, JSON.stringify(repeated));
    assert.deepEqual(repeated.value.query, created.value.query);
  }));

  test(`${backend}: una consulta histórica propia no se convierte en una etapa por tener el mismo número`, async () => fixture(backend, async ({call, recordPath}) => {
    const record = {...query({kind: 'custom', day: 15, revision: 'revision-desconocida'}),
      created_at: originalDate, timezone: 'America/Mexico_City', timestamp_kind: 'recorded'};
    const bytes = Buffer.from(JSON.stringify(record) + '\n');
    await mkdir(dirname(recordPath(record)), {recursive: true});
    await writeFile(recordPath(record), bytes);
    const read = await call('queries');
    assert.equal(read.status, 500, JSON.stringify(read));
    assert.deepEqual(await readFile(recordPath(record)), bytes);
    await unlink(recordPath(record));
    assert.deepEqual((await call('queries')).value.queries, []);
  }));
}
