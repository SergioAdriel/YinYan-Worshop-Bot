import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync} from 'node:fs';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.YINYAN_PYTHON || resolve(root, 'runtime/python/python.exe');
const delay = ms => new Promise(done => setTimeout(done, ms));

async function unusedPort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((done, fail) => probe.close(error => error ? fail(error) : done()));
  return port;
}

async function start(command, args, dataDirectory, port) {
  const child = spawn(command, args, {
    cwd: root, windowsHide: true, stdio: 'pipe',
    env: {...process.env, PORT: String(port), YINYAN_DATA_DIR: dataDirectory},
  });
  let output = '';
  let launchError;
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  child.on('error', error => { launchError = error; });
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`El servidor terminó: ${output}`);
    try {
      const response = await fetch(`${origin}/health`, {signal: AbortSignal.timeout(700)});
      if (response.ok && (await response.json()).app === 'yinyan-workshop') {
        return {child, origin};
      }
    } catch { /* Todavía está abriendo el puerto. */ }
    await delay(75);
  }
  child.kill();
  throw new Error(`El servidor no inició: ${output}`);
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const closed = once(child, 'close');
  child.kill();
  await closed;
}

async function exercise(command, args) {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'yinyan-student-api-'));
  const port = await unusedPort();
  let running;
  try {
    running = await start(command, args, dataDirectory, port);
    const request = async (path, method = 'GET', body) => {
      const response = await fetch(`${running.origin}${path}`, {
        method,
        headers: body === undefined ? {} : {'Content-Type': 'application/json'},
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let value;
      const text = await response.text();
      if (text) {
        try { value = JSON.parse(text); } catch { value = text; }
      }
      return {response, value};
    };
    const state = async () => {
      const {response, value} = await request('/api/examples');
      assert.equal(response.status, 200);
      assert.ok(Array.isArray(value.examples));
      assert.ok(Object.hasOwn(value, 'revision'));
      return value;
    };

    const initial = await state();
    assert.deepEqual(initial.examples, [], 'El almacenamiento temporal comienza vacío.');
    const training = await request('/api/training');
    assert.equal(training.response.status, 200);
    assert.equal(training.value.status, 'idle', 'Leer el estado no inicia entrenamiento.');
    assert.equal(typeof training.value.message, 'string');
    assert.equal((await request('/simulation/custom-model.json')).response.status, 404);
    const wrongTrainMethod = await request('/api/train');
    assert.equal(wrongTrainMethod.response.status, 405, 'Consultar la ruta de entrenamiento no inicia una jornada.');
    assert.equal((await request('/api/training')).value.status, 'idle');

    const first = {text: 'mi lap no prende desde ayer', intent: 'encendido', author: 'alumno-a'};
    const foreignOrigin = await fetch(`${running.origin}/api/examples`, {
      method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'https://externo.invalid'},
      body: JSON.stringify(first),
    });
    assert.equal(foreignOrigin.status, 403, 'Un sitio externo no puede alimentar la aplicación local.');
    assert.deepEqual((await state()).examples, []);
    const wrongType = await fetch(`${running.origin}/api/examples`, {
      method: 'POST', headers: {'Content-Type': 'text/plain'}, body: JSON.stringify(first),
    });
    assert.equal(wrongType.status, 415);
    assert.deepEqual((await state()).examples, []);
    const added = await request('/api/examples', 'POST', {...first, id: 'id-no-confiable'});
    assert.ok([200, 201].includes(added.response.status));
    const one = await state();
    assert.equal(one.examples.length, 1);
    assert.notEqual(one.revision, initial.revision);
    assert.equal(one.examples[0].text, first.text);
    assert.equal(one.examples[0].author, first.author);
    assert.equal(one.examples[0].intent, first.intent);
    assert.equal(one.examples[0].review_status, 'pending', 'Guardar nunca equivale a aprobar.');
    assert.equal(one.approved_examples.length, 0);
    assert.equal(one.approved_revision, initial.approved_revision);
    assert.equal(typeof one.examples[0].id, 'string');
    assert.notEqual(one.examples[0].id, 'id-no-confiable', 'El servidor asigna el identificador.');
    const firstId = one.examples[0].id;

    const duplicate = await request('/api/examples', 'POST', first);
    assert.ok([200, 201, 409].includes(duplicate.response.status));
    assert.equal((await state()).examples.length, 1, 'Un duplicado no aumenta el corpus.');

    for (const body of [
      {...first, text: ''}, {...first, text: '   '}, {...first, text: 'x'.repeat(1201)},
      {...first, intent: 'categoria-inventada'}, {...first, author: 'alumno-c'},
      {...first, author: 'alumno-d'}, {...first, text: {html: '<b>hola</b>'}},
      {text: 'faltan campos'},
    ]) {
      const rejected = await request('/api/examples', 'POST', body);
      assert.ok([400, 413, 422].includes(rejected.response.status), JSON.stringify(body));
      assert.equal((await state()).examples.length, 1, 'La validación no debe escribir parcialmente.');
    }

    const second = {text: 'el cel no agarra el cargador', intent: 'carga', author: 'alumno-b'};
    const addedSecond = await request('/api/examples', 'POST', second);
    assert.equal(addedSecond.response.status, 201);
    const two = await state();
    assert.equal(two.examples.length, 2, 'Ambos estudiantes pueden agregar ejemplos.');
    assert.ok(two.examples.some(row => row.id === firstId), 'Agregar conserva registros anteriores.');
    assert.deepEqual(new Set(two.examples.map(row => row.author)), new Set(['alumno-a', 'alumno-b']));
    assert.equal(new Set(two.examples.map(row => row.id)).size, 2);
    const conflict = await request('/api/examples', 'POST', {...first, intent: 'carga'});
    assert.equal(conflict.response.status, 409, 'La misma consulta no admite dos etiquetas.');
    assert.deepEqual(await state(), two, 'Un conflicto no guarda las filas previas ni cambia la revisión.');

    await stop(running.child);
    running = await start(command, args, dataDirectory, port);
    const persisted = await state();
    assert.deepEqual(persisted, two, 'Reabrir el servidor conserva ejemplos y revisión.');
    const firstOriginalTime = persisted.examples.find(row => row.id === firstId).created_at;
    const approved = await request(`/api/examples/${firstId}/review`, 'POST', {
      review_status: 'approved', author: 'sergio', record_version: persisted.examples.find(row => row.id === firstId).record_version,
    });
    assert.equal(approved.response.status, 200);
    assert.equal(approved.value.approved_examples.length, 1);
    assert.equal(approved.value.approved_examples[0].reviewed_by, 'sergio');
    assert.equal(approved.value.approved_examples[0].created_at, firstOriginalTime);
    assert.equal((await request(`/api/examples/${firstId}`, 'DELETE', {author: 'sergio'})).response.status, 409,
      'Un ejemplo aprobado debe reabrirse antes de retirarse.');
    const reopened = await request(`/api/examples/${firstId}/review`, 'POST', {review_status: 'pending', author: 'raynier'});
    assert.equal(reopened.response.status, 200);
    assert.equal(reopened.value.approved_examples.length, 0);
    assert.equal(reopened.value.approved_revision, initial.approved_revision);
    const deleted = await request(`/api/examples/${encodeURIComponent(firstId)}`, 'DELETE');
    assert.ok([200, 204].includes(deleted.response.status));
    const afterDelete = await state();
    assert.equal(afterDelete.examples.length, 1);
    assert.notEqual(afterDelete.revision, two.revision);
    assert.equal(afterDelete.examples[0].text, second.text);
    const rejectedSecond = await request(`/api/examples/${afterDelete.examples[0].id}/review`, 'POST', {
      review_status: 'rejected', author: 'raynier', note: 'Revisar pertinencia antes de utilizar este ejemplo.',
    });
    assert.equal(rejectedSecond.response.status, 200);
    assert.equal(rejectedSecond.value.examples[0].review_status, 'rejected');
    assert.equal(rejectedSecond.value.approved_examples.length, 0);
    assert.equal((await request('/api/examples/00000000-0000-0000-0000-000000000000', 'DELETE')).response.status, 404);
    assert.equal((await request('/api/training')).value.status, 'idle');

    // Simula únicamente un estado persistido: no inicia Python ni fabrica un resultado del modelo.
    await stop(running.child);
    const failed = {status: 'failed', message: 'Fallo de prueba: Python no estaba disponible.'};
    await writeFile(join(dataDirectory, 'training-status.json'), JSON.stringify(failed), 'utf8');
    running = await start(command, args, dataDirectory, port);
    const restoredFailure = await request('/api/training');
    assert.equal(restoredFailure.value.status, 'failed', 'Reiniciar conserva el fallo para poder corregirlo.');
    assert.equal(restoredFailure.value.message, failed.message);
    assert.equal((await state()).examples.length, 1);
    assert.equal((await state()).examples[0].review_status, 'rejected', 'El reinicio conserva la decisión de revisión.');
  } finally {
    await stop(running?.child);
    // mkdtemp siempre crea este directorio dentro de Temp; nunca apunta al corpus del proyecto.
    assert.equal(dirname(dataDirectory), resolve(tmpdir()));
    assert.ok(dataDirectory.startsWith(join(tmpdir(), 'yinyan-student-api-')));
    await rm(dataDirectory, {recursive: true, force: true});
  }
}

test('API Node: ejemplos de dos alumnos, validación y persistencia',
  {timeout: 45000}, () => exercise(process.execPath, [resolve(root, 'scripts/serve.mjs')]));
test('API Python: mismo contrato de ejemplos sin modificar el corpus original',
  {skip: !existsSync(python), timeout: 45000}, () => exercise(python, [resolve(root, 'scripts/serve.py')]));
