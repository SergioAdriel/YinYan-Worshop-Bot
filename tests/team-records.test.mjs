import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync} from 'node:fs';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.YINYAN_PYTHON || resolve(root, 'runtime/python/python.exe');
const timezone = 'America/Mexico_City';
const delay = ms => new Promise(done => setTimeout(done, ms));
const history = JSON.parse(await readFile(resolve(root, 'data/training/training_history.json'), 'utf8'));

async function start(command, args, dataDir, teamDir) {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(done => probe.close(done));
  const child = spawn(command, args, {
    cwd: root, windowsHide: true, stdio: 'pipe',
    env: {...process.env, PORT: String(port), YINYAN_DATA_DIR: dataDir,
      ...(teamDir ? {YINYAN_TEAM_DIR: teamDir} : {})},
  });
  let output = '', launchError;
  child.stdout.on('data', data => {output += data;});
  child.stderr.on('data', data => {output += data;});
  child.on('error', error => {launchError = error;});
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`El servidor terminó: ${output}`);
    try {
      const response = await fetch(`${origin}/health`, {signal: AbortSignal.timeout(500)});
      if (response.ok && (await response.json()).app === 'yinyan-workshop') return {child, origin};
    } catch { /* El servidor todavía está abriendo su puerto. */ }
    await delay(60);
  }
  child.kill();
  throw new Error(`El servidor no inició: ${output}`);
}

async function stop(server) {
  if (!server || server.child.exitCode !== null) return;
  const closed = once(server.child, 'close');
  server.child.kill();
  await closed;
}

async function request(server, path, method = 'GET', body) {
  const response = await fetch(`${server.origin}${path}`, {
    method, headers: body === undefined ? {} : {'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  return {status: response.status, value: raw ? JSON.parse(raw) : undefined};
}

function recorded(row, before, after) {
  assert.equal(row.timezone, timezone);
  assert.equal(row.timestamp_kind, 'recorded');
  assert.match(row.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const time = Date.parse(row.created_at);
  assert.ok(time >= before && time <= after, 'La fecha la asigna el servidor al guardar.');
}

async function jsonRecords(folder) {
  let entries;
  try {entries = await readdir(folder, {withFileTypes: true});}
  catch (error) {if (error.code === 'ENOENT') return []; throw error;}
  const records = [];
  for (const entry of entries) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) records.push(...await jsonRecords(path));
    else if (entry.name.endsWith('.json')) records.push({path, value: JSON.parse(await readFile(path, 'utf8'))});
  }
  return records;
}

async function exercise(command, args) {
  const workspace = await mkdtemp(join(tmpdir(), 'yinyan-team-records-'));
  const teamDir = join(workspace, 'shared-team');
  const dataA = join(workspace, 'runtime-a'), dataB = join(workspace, 'runtime-b');
  let a, b;
  try {
    a = await start(command, args, dataA, teamDir);
    b = await start(command, args, dataB, teamDir);
    assert.deepEqual((await request(a, '/api/queries')).value.queries, []);
    const initial = (await request(a, '/api/examples')).value;
    assert.deepEqual(initial.examples, []);

    const id = randomUUID();
    const query = {id, session_id: 'sesion-alumno-a', author: 'alumno-a',
      text: 'mi ipone parpadia cuando lo prendo', response: '¿Se reinicia el teléfono o parpadea la pantalla?',
      intent: 'pantalla', accepted: false, model: {kind: 'version', version_id: history.references.stages['8']}, resolution: 'clarification'};
    const before = Date.now();
    const added = await request(a, '/api/queries', 'POST', {
      ...query, created_at: '2001-01-01T00:00:00.000Z', timezone: 'Pacific/Auckland', timestamp_kind: 'client_provided',
    });
    assert.equal(added.status, 201);
    const row = added.value.query;
    assert.equal(row.id, id);
    assert.equal(row.text, query.text);
    assert.equal(row.author, query.author);
    assert.equal(row.reviewed, false);
    recorded(row, before, Date.now());
    assert.deepEqual((await request(a, '/api/examples')).value, initial,
      'Conversar guarda evidencia, pero no convierte una predicción en ejemplo aprobado.');
    const visibleToB = (await request(b, '/api/queries')).value;
    assert.equal(visibleToB.timezone, timezone);
    assert.deepEqual(visibleToB.queries, [row], 'Otro equipo ve la aportación al compartir el registro.');

    const retry = await request(b, '/api/queries', 'POST', query);
    assert.equal(retry.status, 200, 'Reintentar tras una desconexión no duplica la consulta.');
    assert.deepEqual(retry.value.query, row);
    const mismatched = await request(a, '/api/queries', 'POST', {...query, text: 'otro mensaje con el mismo id'});
    assert.equal(mismatched.status, 409);
    assert.equal((await request(a, '/api/queries')).value.queries.length, 1);

    for (const patch of [
      {text: ''}, {text: 'x'.repeat(1201)}, {response: ''}, {response: 'x'.repeat(6001)},
      {session_id: 'x'.repeat(81)}, {author: 'alumno-c'}, {accepted: 'sí'},
      {model: {kind: 'version', version_id: ''}}, {intent: 'inventada'}, {id: '../../fuera'},
    ]) {
      const rejected = await request(a, '/api/queries', 'POST', {...query, id: randomUUID(), ...patch});
      assert.ok([400, 413, 422].includes(rejected.status), JSON.stringify(patch));
    }
    assert.equal((await request(a, '/api/queries')).value.queries.length, 1,
      'Una consulta inválida no deja registros parciales.');

    const reviewBefore = Date.now();
    const reviewed = await request(b, `/api/queries/${id}/example`, 'POST', {
      author: 'alumno-b', intent: 'software', text: 'mi ipone se reinicia y sale el logo',
      created_at: '2001-01-01T00:00:00.000Z',
    });
    assert.equal(reviewed.status, 201);
    const example = reviewed.value.examples[0];
    assert.equal(example.author, 'alumno-b', 'Quien revisa queda identificado además del autor de la consulta.');
    assert.equal(example.text, 'mi ipone se reinicia y sale el logo');
    assert.equal(example.intent, 'software');
    assert.equal(example.source, 'review');
    assert.equal(example.source_query_id, id);
    assert.equal(example.review_status, 'pending');
    assert.equal(reviewed.value.approved_examples.length, 0, 'Revisar la conversación prepara un ejemplo pendiente; la aprobación es explícita.');
    recorded(example, reviewBefore, Date.now());
    assert.notEqual(reviewed.value.revision, initial.revision);
    assert.deepEqual((await request(a, '/api/examples')).value, reviewed.value);
    const updated = (await request(a, '/api/queries')).value.queries[0];
    assert.equal(updated.reviewed, true);
    assert.equal(updated.example_id, example.id);
    assert.equal(updated.created_at, row.created_at, 'La revisión conserva la fecha original de la consulta.');
    assert.equal((await request(a, `/api/queries/${id}/example`, 'POST', {author: 'alumno-b', intent: 'software'})).status, 200);
    assert.equal((await request(a, '/api/examples')).value.examples.length, 1);
    assert.equal((await request(a, `/api/queries/${randomUUID()}/example`, 'POST', {author: 'alumno-b', intent: 'software'})).status, 404);

    const unknown = await request(a, '/api/queries', 'POST', {...query, id: randomUUID(),
      text: example.text, intent: null, accepted: false, response: 'No entendí bien. ¿Puedes explicar la falla?'});
    assert.equal(unknown.status, 201, 'También quedan registradas las consultas que el bot no pudo clasificar.');
    assert.equal((await request(b, `/api/queries/${unknown.value.query.id}/example`, 'POST',
      {author: 'alumno-b', intent: 'software'})).status, 409, 'Una revisión no duplica texto ya aprobado.');
    assert.equal((await request(a, '/api/examples')).value.examples.length, 1);
    assert.equal((await request(a, '/api/queries')).value.queries.find(item => item.id === unknown.value.query.id).reviewed, false,
      'Una revisión rechazada no se marca como aprobada.');

    const approvalBefore = Date.now();
    const approved = await request(a, `/api/examples/${example.id}/review`, 'POST', {
      author: 'sergio', review_status: 'approved', record_version: example.record_version,
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.value.approved_examples.length, 1);
    assert.equal(approved.value.approved_examples[0].reviewed_by, 'sergio');
    assert.ok(Date.parse(approved.value.approved_examples[0].reviewed_at) >= approvalBefore);
    assert.equal(approved.value.approved_examples[0].created_at, example.created_at,
      'Aprobar no altera la fecha original del ejemplo ni de la consulta.');
    const approvedRevision = approved.value.approved_revision;

    const manualBefore = Date.now();
    const simultaneous = await Promise.all([
      request(a, '/api/examples', 'POST', {text: 'la compu tarda mucho en abrir juegos', intent: 'rendimiento', author: 'alumno-a'}),
      request(b, '/api/examples', 'POST', {text: 'el cel no carga con ningun cable', intent: 'carga', author: 'alumno-b'}),
    ]);
    assert.deepEqual(simultaneous.map(result => result.status), [201, 201]);
    const all = (await request(a, '/api/examples')).value;
    assert.equal(all.examples.length, 3, 'Aportaciones concurrentes no se sobrescriben.');
    for (const manual of all.examples.filter(item => item.source === 'manual')) recorded(manual, manualBefore, Date.now());
    assert.equal(all.examples.filter(item => item.source === 'manual').length, 2);
    assert.equal(all.approved_examples.length, 1);
    assert.equal(all.approved_revision, approvedRevision, 'Los nuevos pendientes no modifican el corpus aprobado.');
    assert.equal(all.counts.pending, 2);

    const versionQuery = await request(b, '/api/queries', 'POST', {...query, id: randomUUID(),
      author: 'raynier', session_id: 'version-revisada', model: {kind: 'version', version_id: history.references.base_id}});
    assert.equal(versionQuery.status, 201);
    assert.equal(versionQuery.value.query.model.version_id, history.references.base_id);
    assert.equal((await request(a, '/api/queries')).value.queries.find(item => item.id === versionQuery.value.query.id).author, 'raynier');

    const files = await jsonRecords(teamDir);
    assert.ok(files.some(file => file.path.includes(join('alumno-a', 'queries')) && file.value.id === id));
    assert.ok(files.some(file => file.path.includes(join('alumno-b', 'examples')) && file.value.id === example.id));
    assert.equal((await request(a, `/api/examples/${example.id}`, 'DELETE')).status, 409);
    const reopened = await request(b, `/api/examples/${example.id}/review`, 'POST', {
      review_status: 'pending', author: 'raynier', record_version: approved.value.approved_examples[0].record_version,
    });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.value.approved_examples.length, 0);
    assert.equal((await request(a, `/api/examples/${example.id}`, 'DELETE')).status, 200);
    assert.equal((await request(b, '/api/examples')).value.examples.length, 2);
    assert.ok((await jsonRecords(teamDir)).some(file => file.path.includes('deletions')),
      'Quitar un ejemplo conserva un registro de la decisión para Git.');
    assert.equal((await request(b, '/api/queries')).value.queries.find(item => item.id === id).text, query.text,
      'Cambiar el corpus no borra las conversaciones de prueba.');

    const manualA = (await request(a, '/api/examples')).value.examples.find(item => item.author === 'alumno-a');
    const edited = await request(b, `/api/examples/${manualA.id}`, 'PATCH', {
      text: manualA.text + ' incluso sin aplicaciones abiertas', intent: manualA.intent,
      author: 'raynier', record_version: manualA.record_version,
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.value.examples.find(item => item.id === manualA.id).created_at, manualA.created_at);
    assert.equal(edited.value.examples.find(item => item.id === manualA.id).author, manualA.author);
    const manualB = edited.value.examples.find(item => item.author === 'alumno-b');
    const rejected = await request(a, `/api/examples/${manualB.id}/review`, 'POST', {
      author: 'sergio', review_status: 'rejected', note: 'Pendiente comprobar diversidad.',
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.value.counts.rejected, 1);
    assert.equal(rejected.value.approved_examples.length, 0);

    const finalExamples = (await request(a, '/api/examples')).value;
    const finalQueries = (await request(a, '/api/queries')).value;
    await stop(a); a = undefined;
    await stop(b); b = undefined;
    a = await start(command, args, dataA, teamDir);
    b = await start(command, args, dataB, teamDir);
    assert.deepEqual((await request(a, '/api/examples')).value, finalExamples);
    assert.deepEqual((await request(b, '/api/examples')).value, finalExamples);
    assert.deepEqual((await request(a, '/api/queries')).value, finalQueries);
    assert.deepEqual((await request(b, '/api/queries')).value, finalQueries);
  } finally {
    await Promise.all([stop(a), stop(b)]);
    assert.equal(dirname(workspace), resolve(tmpdir()));
    assert.ok(workspace.startsWith(join(tmpdir(), 'yinyan-team-records-')));
    await rm(workspace, {recursive: true, force: true});
  }
}

async function migrateLegacy(command, args) {
  const workspace = await mkdtemp(join(tmpdir(), 'yinyan-legacy-records-'));
  let server;
  try {
    const old = {examples: [{id: 'legacy-row', text: 'mi computadora no prende', intent: 'encendido', author: 'alumno-a'}]};
    await writeFile(join(workspace, 'student-examples.json'), JSON.stringify(old), 'utf8');
    server = await start(command, args, workspace);
    const rows = (await request(server, '/api/examples')).value.examples;
    assert.equal(rows.length, 1, 'La actualización recupera los ejemplos de la versión anterior.');
    assert.equal(rows[0].text, old.examples[0].text);
    assert.equal(rows[0].created_at, null, 'No se inventa una fecha para registros antiguos.');
    assert.equal(rows[0].timestamp_kind, 'unknown');
    assert.equal(rows[0].review_status, 'pending', 'La migración no inventa una aprobación anterior.');
    assert.deepEqual(JSON.parse(await readFile(join(workspace, 'student-examples.json'), 'utf8')), old,
      'La migración conserva intacto el archivo anterior.');
    assert.equal((await jsonRecords(join(workspace, 'team-records'))).length, 1);
    const before = (await request(server, '/api/examples')).value;
    await stop(server); server = await start(command, args, workspace);
    assert.deepEqual((await request(server, '/api/examples')).value, before, 'Reiniciar no vuelve a importar ni cambia identificadores.');
  } finally {
    await stop(server);
    assert.equal(dirname(workspace), resolve(tmpdir()));
    await rm(workspace, {recursive: true, force: true});
  }
}

for (const [name, command, args, available] of [
  ['Node', process.execPath, [resolve(root, 'scripts/serve.mjs')], true],
  ['Python', python, [resolve(root, 'scripts/serve.py')], existsSync(python)],
]) {
  test(`API ${name}: bitácora real A/B, revisión, dos equipos y persistencia`,
    {skip: !available, timeout: 45000}, () => exercise(command, args));
  test(`API ${name}: migrar ejemplos anteriores sin fabricar fechas`,
    {skip: !available, timeout: 20000}, () => migrateLegacy(command, args));
}
