/** Guardas de regresión del historial; todas las escrituras quedan en Temp. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createWorkflowRegistry} from '../scripts/workflow-registry.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.YINYAN_PYTHON || resolve(root, 'runtime/python/python.exe');
const execute = promisify(execFile);
const keys = ['YINYAN_DATA_DIR', 'YINYAN_TRAINING_DIR', 'YINYAN_TEAM_DIR', 'YINYAN_FINAL_TEST_FILE', 'MPLCONFIGDIR'];
async function isolated(work) {
  const directory = await mkdtemp(join(tmpdir(), 'yinyan-registry-guards-'));
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {YINYAN_DATA_DIR: directory, YINYAN_TRAINING_DIR: join(directory, 'training'),
    YINYAN_TEAM_DIR: join(directory, 'team'), YINYAN_FINAL_TEST_FILE: join(directory, 'final.csv'), MPLCONFIGDIR: join(directory, 'matplotlib')});
  try {await work(directory);}
  finally {
    for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(directory.startsWith(join(tmpdir(), 'yinyan-registry-guards-')));
    await rm(directory, {recursive: true, force: true});
  }
}
async function pythonProbe(directory, script) {
  const prelude = `import json,os,sys\nfrom pathlib import Path\nfrom src.training_runs import Registry,WorkflowError,atomic_json\nregistry=Registry(Path(sys.argv[1]))\n`;
  const {stdout} = await execute(python, ['-c', prelude + script, directory], {cwd: root, windowsHide: true,
    env: {...process.env, PYTHONUTF8: '1'}, maxBuffer: 1024 * 1024});
  return JSON.parse(stdout.trim().split('\n').at(-1));
}

test('Registro: las referencias se leen con almacenamiento aislado sin contarlas como jornadas', async () => isolated(async directory => {
  const registry = createWorkflowRegistry(root, directory);
  const config = await registry.config();
  const reference = await registry.version(config.references.base_id);
  assert.equal(reference.run_type, 'imported_reference');
  assert.equal(reference.approval_status, 'reference');
  assert.equal(reference.kind, 'historical');
  assert.deepEqual((await registry.versions()).versions, []);
  const result = await pythonProbe(directory, `catalog=json.loads((Path.cwd()/'data/training/training_history.json').read_text(encoding='utf-8'))
reference=registry.version(catalog['references']['base_id'])
assert reference['run_type']=='imported_reference'
assert reference['approval_status']=='reference'
assert reference['kind']=='historical'
assert registry.versions()==[]
assert json.loads((registry.run_folder(reference['id'])/'snapshot.json').read_text(encoding='utf-8'))['training_examples']
print(json.dumps({'reference_id':reference['id']}))`);
  assert.equal(result.reference_id, reference.id);
}));

test('Registro: un segundo proceso no reclama ni marca fallida una jornada todavía activa', async () => isolated(async directory => {
  const result = await pythonProbe(directory, `run=registry.reserve({'approved_examples':[],'approved_revision':'empty-approved-snapshot'},'system')
folder=registry.run_folder(run['id'])
running=registry.raw(run['id'])
running['process_id']=os.getpid()
atomic_json(folder/'run.json',running)
before=(folder/'run.json').read_bytes()
try:
    registry.train(run['id'])
    raise AssertionError('El segundo intento no fue rechazado')
except WorkflowError as error:
    assert error.status==409
after=registry.raw(run['id'])
assert (folder/'run.json').read_bytes()==before
assert after['status']=='running' and after['process_id']==os.getpid()
print(json.dumps({'status':after['status'],'original_claim_preserved':True}))`);
  assert.equal(result.status, 'running');
  assert.equal(result.original_claim_preserved, true);
}));

test('Registro: un manifiesto incompleto no puede reemplazar el modelo activo', async () => isolated(async directory => {
  const result = await pythonProbe(directory, `from uuid import uuid4
identifier=str(uuid4())
atomic_json(registry.run_folder(identifier)/'run.json',{'id':identifier,'status':'succeeded','checks':{'export_parity':True},'artifact_hashes':{}})
before=registry.active()
try:
    registry.activate(identifier,'system')
    raise AssertionError('Se activo una version sin artefactos')
except WorkflowError as error:
    assert error.status==409
assert registry.active()==before
assert registry.active_id() is None
assert not (registry.run_folder(identifier)/'approvals').exists()
print(json.dumps({'rejected':True,'active_model_preserved':True}))`);
  assert.deepEqual(result, {rejected: true, active_model_preserved: true});
}));

test('Progreso: cincuenta saltos dentro de una consulta CSV no equivalen a cincuenta ejemplos', async () => isolated(async directory => {
  const lines = Array.from({length: 60}, (_, index) => `Detalle de pantalla numero ${index + 1}`).join('\n');
  await writeFile(process.env.YINYAN_FINAL_TEST_FILE, `text,intent\r\n"${lines}",pantalla\r\n`, 'utf8');
  const registry = createWorkflowRegistry(root, directory);
  const progress = await registry.progress({examples: [], approved_examples: [], approved_revision: 'empty-approved'});
  assert.equal(progress.final_test_size, 1);
  assert.equal(progress.rubric.find(row => row.id === 'final').status, 'Pendiente de datos');
}));

test('Registro Node: consultar el historial recupera una jornada huérfana persistida', async () => isolated(async directory => {
  const identifier = randomUUID(), folder = join(directory, 'training', 'runs', identifier);
  await mkdir(folder, {recursive: true});
  // Es un fixture de interrupción en Temp, no un registro de trabajo del equipo.
  const interrupted = {id: identifier, journey: 1, author: 'system', status: 'running', process_id: null,
    created_at: new Date(Date.now() - 35000).toISOString(), finished_at: null,
    message: 'Fixture de una reserva cuyo proceso no llego a iniciarse.'};
  await writeFile(join(folder, 'run.json'), JSON.stringify(interrupted), 'utf8');
  const registry = createWorkflowRegistry(root, directory);
  const result = await registry.versions();
  assert.equal(result.versions.length, 1);
  assert.equal(result.versions[0].id, identifier);
  assert.equal(result.versions[0].status, 'failed');
  assert.equal(result.active_id, null);
  const stored = JSON.parse(await readFile(join(folder, 'run.json'), 'utf8'));
  assert.equal(stored.status, 'failed');
  assert.equal(stored.created_at, interrupted.created_at);
  assert.ok(Date.parse(stored.finished_at) >= Date.parse(interrupted.created_at));
  assert.equal((await registry.versions()).versions[0].finished_at, stored.finished_at,
    'Leer otra vez conserva el cierre registrado y no crea una nueva jornada.');
}));
