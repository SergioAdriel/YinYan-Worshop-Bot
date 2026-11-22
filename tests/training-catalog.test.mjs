import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile, spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {existsSync} from 'node:fs';
import {cp, mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {csvRows} from '../scripts/team-store.mjs';
import {referenceSource, trainingCatalog} from '../scripts/training-catalog.mjs';
import {restoreTrainingCatalog} from '../scripts/restore-training-catalog.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = path => readFile(path, 'utf8').then(JSON.parse);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const delay = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const execute = promisify(execFile);

async function copyReferenceSources(project) {
  await Promise.all(['data/simulation.json', 'data/test.csv', 'web/simulation'].map(async name => {
    await mkdir(dirname(resolve(project, name)), {recursive: true});
    await cp(resolve(root, name), resolve(project, name), {recursive: true});
  }));
}

async function removeFixture(workspace, prefix) {
  const target = await realpath(workspace);
  assert.equal(dirname(target), await realpath(tmpdir()));
  assert.ok(basename(target).startsWith(prefix));
  assert.equal(resolve(target), resolve(workspace));
  await rm(target, {recursive: true, force: true, maxRetries: 3, retryDelay: 100});
}

test('Restaurar importa una vez, recupera el catálogo ausente y conserva archivos divergentes', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'yinyan-restore-catalog-'));
  try {
    await copyReferenceSources(workspace);
    const activePath = resolve(workspace, 'data/training/active.json');
    const realPath = resolve(workspace, 'data/training/runs/00000000-0000-4000-8000-000000000001/run.json');
    const contributionPath = resolve(workspace, 'data/team/aporte-conservado.json');
    for (const path of [activePath, realPath, contributionPath]) {
      await mkdir(dirname(path), {recursive: true});
      await writeFile(path, '{"fixture":"conservar sin cambios"}\r\n');
    }
    const first = await restoreTrainingCatalog(workspace);
    assert.equal(first.created_files, 61);
    assert.equal(first.references, 15);
    assert.deepEqual(await restoreTrainingCatalog(workspace), {...first, created_files: 0, unchanged_files: 61});
    for (const path of [activePath, realPath, contributionPath]) {
      assert.equal(await readFile(path, 'utf8'), '{"fixture":"conservar sin cambios"}\r\n');
    }
    const catalogPath = resolve(workspace, first.catalog), originalCatalog = await readFile(catalogPath);
    await unlink(catalogPath);
    assert.equal((await restoreTrainingCatalog(workspace)).created_files, 1);
    assert.deepEqual(await readFile(catalogPath), originalCatalog);

    // A divergent late reference must prevent publication of a missing catalog.
    const snapshotPath = resolve(workspace, 'data/training/runs', first.base_id, 'snapshot.json');
    const divergent = Buffer.from('{"fixture":"historial que requiere revisión"}\n');
    await writeFile(snapshotPath, divergent);
    await unlink(catalogPath);
    await assert.rejects(restoreTrainingCatalog(workspace), /Se conservó el archivo existente/);
    assert.deepEqual(await readFile(snapshotPath), divergent);
    assert.equal(existsSync(catalogPath), false);
  } finally { await removeFixture(workspace, 'yinyan-restore-catalog-'); }
});

test('La recuperación valida incluso la última fuente antes de escribir referencias', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'yinyan-invalid-reference-'));
  try {
    await copyReferenceSources(workspace);
    const modelPath = resolve(workspace, 'web/simulation/day-15.json');
    const model = await readJson(modelPath);
    model.simulation_day = 14;
    await writeFile(modelPath, JSON.stringify(model));
    await assert.rejects(restoreTrainingCatalog(workspace), /modelo de la etapa 15/);
    assert.equal(existsSync(resolve(workspace, 'data/training')), false);
  } finally { await removeFixture(workspace, 'yinyan-invalid-reference-'); }
});

test('Los clones con autocrlf activado y desactivado conservan hashes y permiten recuperar el catálogo',
  {skip: spawnSync('git', ['--version'], {windowsHide: true}).status !== 0, timeout: 30000}, async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'yinyan-catalog-git-'));
    const repository = resolve(workspace, 'origen'), realId = '861484ac-3558-43d4-a997-959aeec83d47';
    const env = {...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: resolve(workspace, 'gitconfig-aislado'),
      GIT_TERMINAL_PROMPT: '0'};
    const git = (cwd, ...args) => execute('git', args, {cwd, env, windowsHide: true, maxBuffer: 1024 * 1024});
    try {
      await copyReferenceSources(repository);
      await cp(resolve(root, 'data/training/runs', realId), resolve(repository, 'data/training/runs', realId), {recursive: true});
      await git(repository, 'init');
      // Reproduce the original repository: Git normalized the old CRLF files.
      await git(repository, '-c', 'core.autocrlf=true', 'add', 'data', 'web');
      await cp(resolve(root, '.gitattributes'), resolve(repository, '.gitattributes'));
      await cp(resolve(root, 'data/training'), resolve(repository, 'data/training'), {recursive: true});
      await Promise.all(['docs', 'reports', 'notebooks', 'references'].map(name =>
        cp(resolve(root, name), resolve(repository, name), {recursive: true})));
      await git(repository, '-c', 'core.autocrlf=true', 'add', '.gitattributes', 'data/training',
        'docs', 'reports', 'notebooks', 'references');
      await git(repository, '-c', 'user.name=Prueba local', '-c', 'user.email=prueba@example.invalid',
        '-c', 'commit.gpgsign=false', 'commit', '-m', 'Fixture de catálogo y política de bytes');
      for (const autocrlf of ['true', 'false']) {
        const project = resolve(workspace, `clon-${autocrlf}`);
        await git(workspace, '-c', `core.autocrlf=${autocrlf}`, 'clone', '--no-hardlinks', repository, project);
        const catalog = await trainingCatalog(project);
        for (const id of [...Object.values(catalog.references.stages), realId]) {
          const folder = resolve(project, 'data/training/runs', id), run = await readJson(join(folder, 'run.json'));
          for (const [name, expected] of Object.entries(run.artifact_hashes)) {
            assert.equal(digest(await readFile(join(folder, name))), expected, `${autocrlf}: ${id}/${name}`);
          }
        }
        const expectedCatalog = await readFile(resolve(project, 'data/training/training_history.json'));
        assert.equal((await restoreTrainingCatalog(project)).created_files, 0, `Idempotencia con autocrlf=${autocrlf}.`);
        await unlink(resolve(project, 'data/training/training_history.json'));
        assert.equal((await restoreTrainingCatalog(project)).created_files, 1);
        assert.deepEqual(await readFile(resolve(project, 'data/training/training_history.json')), expectedCatalog);
        for (const relative of ['', 'references/avance-2026-11-18', 'references/pre-history-unification-2026-11-18']) {
          const documents = resolve(project, relative);
          const verification = await readJson(resolve(documents, 'docs/pdf-verification.json'));
          assert.equal(digest(await readFile(resolve(documents, 'notebooks/experimentacion.ipynb'))), verification.notebook.sha256);
          assert.equal(digest(await readFile(resolve(documents, verification.metrics_path))), verification.metrics_sha256);
          const delivery = await readJson(resolve(documents, 'reports/current-delivery-verification.json'));
          for (const [name, expected] of Object.entries(delivery.artifact_hashes)) {
            assert.equal(digest(await readFile(resolve(documents, name))), expected, `${autocrlf}: ${relative}/${name}`);
          }
          if (relative) {
            const manifest = await readJson(resolve(documents, relative.includes('pre-history') ? 'BACKUP.json' : 'REFERENCE.json'));
            for (const record of manifest.files) {
              const bytes = await readFile(resolve(documents, record.path));
              assert.equal(digest(bytes), record.sha256, `${autocrlf}: ${relative}/${record.path}`);
              assert.equal(bytes.length, record.bytes);
            }
          }
        }
      }
    } finally { await removeFixture(workspace, 'yinyan-catalog-git-'); }
  });

test('Un catálogo ausente o dañado informa cómo repararlo sin crear datos al leerlo', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'yinyan-missing-catalog-'));
  try {
    const missingProject = join(workspace, 'ausente');
    await assert.rejects(trainingCatalog(missingProject), error => {
      assert.equal(error.status, 500);
      assert.match(error.message, /training_history\.json/);
      assert.match(error.message, /restore-training-catalog/);
      return true;
    });
    assert.equal(existsSync(missingProject), false, 'Leer no reconstruye un historial ni escribe una carpeta.');
    const damagedProject = join(workspace, 'danado');
    const catalogPath = resolve(damagedProject, 'data/training/training_history.json');
    await mkdir(dirname(catalogPath), {recursive: true});
    const original = '{ catalogo sin cerrar';
    await writeFile(catalogPath, original, 'utf8');
    await assert.rejects(trainingCatalog(damagedProject), error => {
      assert.equal(error.status, 500);
      assert.match(error.message, /catálogo/i);
      return true;
    });
    assert.equal(await readFile(catalogPath, 'utf8'), original);
    assert.equal(existsSync(resolve(damagedProject, 'data/training/runs')), false);
  } finally {
    const target = await realpath(workspace);
    assert.equal(dirname(target), await realpath(tmpdir()));
    assert.ok(basename(target).startsWith('yinyan-missing-catalog-'));
    assert.equal(resolve(target), resolve(workspace));
    await rm(target, {recursive: true, force: true, maxRetries: 3, retryDelay: 100});
  }
});

test('El catálogo contiene las quince referencias completas y conserva sus datos simulados', async () => {
  const [catalog, corpus, manifest, evaluationCsv] = await Promise.all([
    trainingCatalog(root), readJson(resolve(root, 'data/simulation.json')),
    readJson(resolve(root, 'web/simulation/manifest.json')), readFile(resolve(root, 'data/test.csv'), 'utf8'),
  ]);
  const [header, ...rows] = csvRows(evaluationCsv.replace(/^\uFEFF/, ''));
  const evaluation = rows.filter(row => row.some(Boolean)).map(row => Object.fromEntries(header.map((key, index) => [key, row[index]])));
  assert.deepEqual(catalog.labels, corpus.labels);
  assert.deepEqual(Object.keys(catalog.references.stages).map(Number).sort((a, b) => a - b),
    Array.from({length: 15}, (_, index) => index + 1));
  assert.equal(new Set(Object.values(catalog.references.stages)).size, 15);
  let accumulated = [];
  for (const day of corpus.days) {
    accumulated = [...accumulated, ...day.examples];
    const id = catalog.references.stages[String(day.day)];
    assert.match(id, uuid);
    const folder = resolve(root, 'data/training/runs', id);
    const [run, snapshot, model, benchmark, originalModel] = await Promise.all([
      readJson(join(folder, 'run.json')), readJson(join(folder, 'snapshot.json')),
      readJson(join(folder, 'model.json')), readJson(join(folder, 'benchmark.json')),
      readJson(resolve(root, `web/simulation/day-${String(day.day).padStart(2, '0')}.json`)),
    ]);
    assert.equal(run.id, id);
    assert.equal(run.run_type, 'imported_reference');
    assert.equal(run.timestamp_kind, 'simulated', 'Importar una referencia no la convierte en una jornada real.');
    assert.equal(run.reference_stage, day.day);
    assert.equal(run.status, 'succeeded');
    assert.deepEqual(snapshot.training_examples, accumulated, `Instantánea acumulada de la etapa ${day.day}.`);
    assert.ok(snapshot.training_examples.every(row => row.timestamp_kind === 'simulated'));
    assert.deepEqual(model, originalModel, `Modelo original de la etapa ${day.day}, sin reentrenarlo.`);
    assert.deepEqual(benchmark, evaluation, 'El benchmark publicado se conserva como evaluación.');
    const curve = catalog.reference_curve.find(row => row.day === day.day);
    const measured = manifest.days.find(row => row.day === day.day);
    assert.ok(curve, `La curva conserva la etapa ${day.day}.`);
    assert.equal(curve.accuracy, measured.accuracy);
    assert.equal(curve.correct, measured.correct);
    assert.equal(curve.total, measured.total);
  }
  const source = await referenceSource(root);
  assert.deepEqual(source.examples, accumulated);
  assert.equal(source.examples.length, 240);
  assert.equal(source.version.run_type, 'imported_reference');
  assert.ok(source.model.preprocessing);
});

async function freePort() {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((done, fail) => socket.close(error => error ? fail(error) : done()));
  return port;
}

async function start(project, port) {
  const env = {...process.env, PORT: String(port)};
  for (const key of Object.keys(env)) if (key.startsWith('YINYAN_')) delete env[key];
  // Este proceso debe poder leer ejemplos y modelos aunque no exista Python.
  env.YINYAN_PYTHON = resolve(project, 'sin-python.exe');
  const child = spawn(process.execPath, [resolve(project, 'scripts/serve.mjs')], {
    cwd: project, env, windowsHide: true, stdio: 'pipe',
  });
  const origin = `http://127.0.0.1:${port}`;
  let output = '', launchError;
  child.stdout.on('data', part => {output += part;});
  child.stderr.on('data', part => {output += part;});
  child.on('error', error => {launchError = error;});
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error(output);
      try {
        const response = await fetch(`${origin}/health`, {signal: AbortSignal.timeout(500)});
        if (response.ok && (await response.json()).app === 'yinyan-workshop') return {child, origin};
      } catch { /* El proceso todavía está abriendo su puerto. */ }
      await delay(60);
    }
    throw new Error(`No inició el servidor: ${output}`);
  } catch (error) {
    await stop(child);
    throw error;
  }
}

async function stop(child) {
  if (child && child.exitCode === null && !child.killed) {
    const closed = once(child, 'close');
    child.kill();
    await closed;
  }
}

test('Una copia sin runtime ni cachés carga ejemplos, modelos y progreso y conserva un aporte al reiniciar',
  {timeout: 45000}, async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'yinyan-clean-copy-'));
    const project = join(workspace, 'proyecto');
    const sourceActive = await readFile(resolve(root, 'data/training/active.json'));
    let running;
    try {
      await mkdir(project);
      await Promise.all([
        ...['scripts', 'web', 'data'].map(name => cp(resolve(root, name), resolve(project, name), {
          recursive: true, filter: path => path !== resolve(root, 'data/local'),
        })),
        cp(resolve(root, 'package.json'), resolve(project, 'package.json')),
      ]);
      assert.equal(existsSync(resolve(project, 'runtime')), false);
      assert.equal(existsSync(resolve(project, 'data/local')), false);
      const catalog = await trainingCatalog(project);
      const active = await readJson(resolve(project, 'data/training/active.json'));
      const port = await freePort();
      running = await start(project, port);
      const request = async (path, method = 'GET', body) => {
        const response = await fetch(`${running.origin}${path}`, {
          method, headers: body === undefined ? {} : {'Content-Type': 'application/json'},
          body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000),
        });
        const value = await response.json();
        assert.ok(response.ok, `${path}: ${JSON.stringify(value)}`);
        return {status: response.status, value};
      };
      const initial = (await request('/api/examples')).value;
      assert.ok(Array.isArray(initial.examples));
      const versions = (await request('/api/versions')).value;
      assert.ok(versions.versions.some(row => row.id === active.active_id), 'La jornada real sigue disponible.');
      assert.ok(versions.versions.every(row => row.run_type !== 'imported_reference'),
        'Las referencias simuladas no aparecen como jornadas reales del equipo.');
      const selected = (await request('/api/models/active')).value;
      assert.equal(selected.active_id, active.active_id);
      const model = (await request(`/api/versions/${catalog.references.base_id}/model.json`)).value;
      assert.equal(model.classes.length, 16);
      const progress = (await request('/api/progress')).value;
      assert.equal(progress.counts.base, 240);
      assert.equal(progress.per_intent.length, 16);
      const text = 'La laptop se queda inmovil al renderizar un plano tridimensional enorme';
      const saved = await request('/api/examples', 'POST', {text, intent: 'rendimiento', author: 'alumno-a'});
      assert.equal(saved.status, 201);
      const example = saved.value.examples.find(row => row.text === text);
      assert.ok(example);
      assert.equal(example.review_status, 'pending');
      assert.equal(saved.value.examples.length, initial.examples.length + 1);
      await stop(running.child);
      running = await start(project, port);
      assert.deepEqual((await request('/api/examples')).value, saved.value);
      assert.equal((await request('/api/models/active')).value.active_id, active.active_id);
      assert.equal(existsSync(resolve(root, 'data/team/alumno-a/examples', `${example.id}.json`)), false,
        'El aporte de prueba solo se escribe dentro de la copia temporal.');
      assert.deepEqual(await readFile(resolve(root, 'data/training/active.json')), sourceActive);
    } finally {
      await stop(running?.child);
      const target = await realpath(workspace);
      assert.equal(dirname(target), await realpath(tmpdir()));
      assert.ok(basename(target).startsWith('yinyan-clean-copy-'));
      assert.equal(resolve(target), resolve(workspace));
      await rm(target, {recursive: true, force: true, maxRetries: 3, retryDelay: 100});
    }
  });
