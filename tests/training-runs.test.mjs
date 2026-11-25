import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtemp, readFile, writeFile, readdir, mkdir, rm, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, dirname, join, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.YINYAN_PYTHON || resolve(root, 'runtime/python/python.exe');
const delay = ms => new Promise(done => setTimeout(done, ms));
async function freePort() {const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const port = socket.address().port; await new Promise(done => socket.close(done)); return port;}
async function stop(child) {if (child && child.exitCode === null) {const closed = once(child, 'close'); child.kill(); await closed;}}
async function exercise(command, script) {
  const workspace = await mkdtemp(join(tmpdir(), 'yinyan-version-tests-'));
  const data = join(workspace, 'local'), registry = join(data, 'training'), finalFile = join(workspace, 'final.csv');
  const env = {...process.env, PORT: String(await freePort()), YINYAN_DATA_DIR: data,
    YINYAN_TEAM_DIR: join(workspace, 'team'), YINYAN_TRAINING_DIR: registry,
    YINYAN_FINAL_TEST_FILE: finalFile, MPLCONFIGDIR: join(workspace, 'matplotlib')};
  const origin = `http://127.0.0.1:${env.PORT}`;
  let child, logs = '';
  async function start() {
    child = spawn(command, [resolve(root, script)], {cwd: root, env, windowsHide: true, stdio: 'pipe'});
    child.stdout.on('data', part => {logs += part;}); child.stderr.on('data', part => {logs += part;});
    for (let i = 0; i < 100; i++) {if (child.exitCode !== null) throw new Error(logs); try {if ((await fetch(origin + '/health')).ok) return;} catch {} await delay(70);}
    throw new Error('No inició el servidor: ' + logs);
  }
  async function request(path, method = 'GET', body) {
    const response = await fetch(origin + path, {method, headers: body ? {'Content-Type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});
    return {status: response.status, value: await response.json()};
  }
  async function complete() {
    for (let i = 0; i < 300; i++) {const result = (await request('/api/training')).value; if (result.status === 'succeeded') return result; if (result.status === 'failed') throw new Error(result.message); await delay(150);}
    throw new Error('Entrenamiento sin terminar: ' + logs);
  }
  async function cli(args) {
    const process = spawn(python, ['-m', 'src.training_runs', ...args, '--runtime', data], {cwd: root, env, windowsHide: true, stdio: 'pipe'});
    let output = ''; process.stdout.on('data', part => {output += part;}); process.stderr.on('data', part => {output += part;});
    const [code] = await once(process, 'close');
    return {code, value: JSON.parse(output.trim().split('\n').at(-1))};
  }
  try {
    await writeFile(finalFile, 'text,intent\n'); await start();
    let saved = await request('/api/examples', 'POST', {text: 'Mi laptop se queda atascada al guardar videos muy grandes', intent: 'rendimiento', author: 'alumno-a'});
    const example = saved.value.examples[0]; assert.equal(example.review_status, 'pending');
    await request('/api/examples', 'POST', {text: 'El celular muestra lineas verdes al desbloquear por la manana', intent: 'pantalla', author: 'alumno-b'});
    saved = await request(`/api/examples/${example.id}/review`, 'POST', {author: 'sergio', review_status: 'approved', record_version: example.record_version});
    assert.equal(saved.status, 200); assert.equal(saved.value.approved_examples.length, 1);
    const pending = saved.value.examples.find(row => row.id !== example.id);
    assert.equal((await request(`/api/examples/${pending.id}/review`, 'POST', {author: 'raynier', review_status: 'rejected', record_version: pending.record_version})).status, 200);
    const initial = await request('/api/train', 'POST', {author: 'raynier'}); assert.equal(initial.status, 202);
    assert.equal((await request('/api/train', 'POST', {author: 'sergio'})).status, 409);
    const first = await complete(), firstId = first.run_id;
    const firstRun = (await request(`/api/versions/${firstId}`)).value;
    assert.equal(firstRun.journey, 1); assert.equal(firstRun.approval_status, 'provisional');
    assert.equal(firstRun.counts.additional, 1); assert.equal(firstRun.counts.total, 241);
    assert.deepEqual(Object.keys(firstRun.models).sort(), ['logistic_regression', 'naive_bayes', 'random_forest']);
    assert.equal(firstRun.selected_model, 'random_forest');
    assert.equal(firstRun.cv_winner, Object.keys(firstRun.cv).reduce((winner, name) =>
      firstRun.cv[name].f1_macro_mean > firstRun.cv[winner].f1_macro_mean ||
      (firstRun.cv[name].f1_macro_mean === firstRun.cv[winner].f1_macro_mean && name === 'logistic_regression') ? name : winner));
    for (const model of Object.values(firstRun.models)) {
      for (const name of ['accuracy', 'precision_macro', 'recall_macro', 'f1_macro']) assert.ok(model[name] >= 0 && model[name] <= 1);
      assert.equal(model.confusion_matrix.flat().reduce((a, b) => a + b), 80);
    }
    const firstFolder = join(registry, 'runs', firstId);
    const snapshotBytes = await readFile(join(firstFolder, 'snapshot.json'));
    const frozen = JSON.parse(snapshotBytes);
    assert.equal(frozen.additional_examples.length, 1); assert.equal(frozen.additional_examples[0].id, example.id);
    for (const model of ['naive_bayes', 'logistic_regression', 'random_forest']) assert.ok((await readFile(join(firstFolder, `${model}.joblib`))).length > 100);
    assert.equal((await request('/api/models/active')).value.active_id, null, 'Entrenar no activa automáticamente.');
    assert.equal((await request(`/api/versions/${firstId}/activate`, 'POST', {author: 'sergio'})).status, 200);
    await stop(child); await start(); assert.equal((await request('/api/models/active')).value.active_id, firstId);
    assert.equal((await request('/api/train', 'POST', {author: 'sergio'})).status, 202);
    const second = await complete(), secondId = second.run_id;
    const secondRun = (await request(`/api/versions/${secondId}`)).value;
    assert.notEqual(secondId, firstId); assert.equal(secondRun.journey, 2);
    assert.equal(secondRun.comparison.previous_id, firstId); assert.equal(secondRun.comparison.same_dataset, true);
    assert.equal((await request('/api/models/active')).value.active_id, firstId);
    assert.deepEqual(await readFile(join(firstFolder, 'snapshot.json')), snapshotBytes);
    assert.equal((await request(`/api/versions/${secondId}/activate`, 'POST', {author: 'raynier'})).status, 200);
    assert.equal((await request(`/api/versions/${firstId}/activate`, 'POST', {author: 'sergio'})).status, 200);
    assert.equal((await request('/api/models/active')).value.active_id, firstId, 'Se puede recuperar una versión histórica.');
    assert.equal((await cli(['train', '--id', firstId])).code, 1, 'No se sobrescribe un entrenamiento terminado.');
    assert.equal((await request(`/api/versions/${firstId}/evaluate-final`, 'POST', {author: 'sergio'})).status, 400);
    const labels = firstRun.labels;
    const rows = Array.from({length: 50}, (_, index) => [`Caso reservado de QA protocolo numero ${index} ${index + 1000}`, labels[index % labels.length]]);
    const csv = values => 'text,intent\n' + values.map(row => row.map(value => JSON.stringify(value)).join(',')).join('\n') + '\n';
    await writeFile(finalFile, csv(rows));
    const final = await request(`/api/versions/${firstId}/evaluate-final`, 'POST', {author: 'raynier'});
    assert.equal(final.status, 200, JSON.stringify(final.value)); assert.equal(final.value.total, 50);
    assert.ok(Object.hasOwn(final.value.metrics, 'f1_macro'));
    const finalDetail = (await request(`/api/versions/${firstId}`)).value;
    assert.equal(finalDetail.final_evaluation.evaluated_at, final.value.evaluated_at, 'Los resultados finales guardados vuelven al consultar una versión.');
    assert.deepEqual(finalDetail.final_evaluation.metrics, final.value.metrics);
    assert.equal((await request('/api/progress')).value.rubric.find(row => row.id === 'final').status, 'Cumplido');
    assert.equal((await request(`/api/versions/${firstId}/evaluate-final`, 'POST', {author: 'raynier'})).value.evaluated_at, final.value.evaluated_at);
    await writeFile(finalFile, csv([...rows].reverse()));
    assert.equal((await request(`/api/versions/${secondId}/evaluate-final`, 'POST', {author: 'sergio'})).status, 409, 'Reordenar la prueba no permite usarla para elegir otra versión.');
    await writeFile(finalFile, csv([['Expresion de QA completamente nueva 99999', 'ayuda'], ...rows.slice(1)]));
    assert.equal((await request(`/api/versions/${secondId}/evaluate-final`, 'POST', {author: 'sergio'})).status, 409, 'Cambiar una frase no convierte las otras 49 ya expuestas en una prueba independiente.');
    await writeFile(finalFile, await readFile(resolve(root, 'data/test.csv')));
    assert.equal((await request(`/api/versions/${secondId}/evaluate-final`, 'POST', {author: 'sergio'})).status, 400, 'El benchmark conocido no es una prueba inédita.');
    const invalidInput = join(workspace, 'invalid-snapshot.json');
    await writeFile(invalidInput, JSON.stringify({approved_examples: [{...frozen.base_examples[0], review_status: 'approved'}], approved_revision: 'negative-test'}));
    const reserved = await cli(['reserve', '--input', invalidInput]); assert.equal(reserved.code, 0);
    const failed = await cli(['train', '--id', reserved.value.id]); assert.equal(failed.code, 1);
    const failedRun = (await request(`/api/versions/${reserved.value.id}`)).value;
    assert.equal(failedRun.status, 'failed'); assert.equal(failedRun.journey, 3);
    assert.equal((await request('/api/models/active')).value.active_id, firstId);
    const secondModel = join(registry, 'runs', secondId, 'model.json');
    await writeFile(secondModel, '{}');
    assert.equal((await request(`/api/versions/${secondId}/activate`, 'POST', {author: 'sergio'})).status, 409);
    assert.equal((await request('/api/models/active')).value.active_id, firstId);
    const progress = (await request('/api/progress')).value;
    assert.equal(progress.counts.pending, 0); assert.equal(progress.counts.rejected, 1); assert.equal(progress.counts.approved_additional, 1);
    assert.equal((await readdir(join(registry, 'runs'))).length, 3);
  } finally {
    await stop(child);
    const target = await realpath(workspace); assert.equal(dirname(target), await realpath(tmpdir()));
    assert.ok(basename(target).startsWith('yinyan-version-tests-'));
    await rm(target, {recursive: true, force: true, maxRetries: 5, retryDelay: 120});
  }
}
test('Jornadas Node: tres modelos, aprobación, historial, fallos y prueba final reservada', {timeout: 160000}, () => exercise(process.execPath, 'scripts/serve.mjs'));
test('Jornadas Python: mismo protocolo, persistencia y activación controlada', {timeout: 160000}, () => exercise(python, 'scripts/serve.py'));
