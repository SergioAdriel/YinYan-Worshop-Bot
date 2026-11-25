/** QA de la práctica estudiantil. Datos y perfil de Chrome aislados en Temp. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'reports');
const workspace = await mkdtemp(join(tmpdir(), 'yinyan-workflow-qa-'));
const dataDirectory = join(workspace, 'student-data');
const profile = join(workspace, 'chrome-profile');
const browserPath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const cdpPort = Number(process.env.YINYAN_QA_CDP_PORT || 9241);
const serverPort = Number(process.env.YINYAN_QA_PORT || 4191);
const origin = `http://127.0.0.1:${serverPort}`;
const trainRequested = true;
const delay = ms => new Promise(done => setTimeout(done, ms));
const results = [];
const errors = [];
const consoleErrors = [];
const requests = [];
const blocked = [];
const pending = new Map();
let nextId = 0;
let socket;
let chrome;
let server;
let serverLog = '';
let failure;
let customTraining;
let manifest;

async function waitUntil(check, timeout = 20000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { last = await check(); if (last) return last; } catch (error) { last = error; }
    await delay(120);
  }
  throw new Error(`Se agotó la espera: ${String(last)}`);
}

function command(method, params = {}) {
  return new Promise((done, fail) => {
    const id = ++nextId;
    const timer = setTimeout(() => {pending.delete(id); fail(new Error(`CDP sin respuesta: ${method}`));}, 20000);
    pending.set(id, {
      done: result => {clearTimeout(timer); done(result);},
      fail: error => {clearTimeout(timer); fail(error);},
    });
    socket.send(JSON.stringify({id, method, params}));
  });
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function click(selector) {
  assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), true, selector);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await delay(90);
}
async function fill(selector, value) {
  await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw new Error('Falta '+${JSON.stringify(selector)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
}
async function sendChat(text) {
  const before = await evaluate(`document.querySelectorAll('.message.assistant').length`);
  await fill('#message-input', text);
  await evaluate(`document.getElementById('chat-form').requestSubmit()`);
  await waitUntil(() => evaluate(`document.querySelectorAll('.message.assistant').length > ${before} && !document.getElementById('message-input').disabled`));
  return evaluate(`Array.from(document.querySelectorAll('.message.assistant .bubble')).at(-1).textContent`);
}
async function check(name, work) {
  try {await work(); results.push({name, passed: true}); console.log(`OK ${name}`);}
  catch (error) {results.push({name, passed: false, error: error.message}); throw error;}
}
async function screenshot(name) {
  const result = await command('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true});
  await writeFile(resolve(output, name), Buffer.from(result.data, 'base64'));
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const closed = once(child, 'close'); child.kill(); await closed;
}
function localRequest(url) {
  try {const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) && ['127.0.0.1', 'localhost'].includes(parsed.hostname);}
  catch {return false;}
}

try {
  await mkdir(output, {recursive: true});
  server = spawn(process.execPath, [resolve(root, 'scripts/serve.mjs')], {
    cwd: root, windowsHide: true, stdio: 'pipe',
    env: {...process.env, PORT: String(serverPort), YINYAN_DATA_DIR: dataDirectory},
  });
  server.stdout.on('data', data => {serverLog += data;});
  server.stderr.on('data', data => {serverLog += data;});
  server.on('error', error => {serverLog += error.message;});
  await waitUntil(async () => {
    if (server.exitCode !== null) throw new Error(serverLog);
    const response = await fetch(`${origin}/health`);
    return response.ok && (await response.json()).app === 'yinyan-workshop';
  });
  manifest = await (await fetch(`${origin}/simulation/manifest.json`)).json();
  chrome = spawn(browserPath, [
    '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--disable-default-apps', '--metrics-recording-only', '--no-pings', 'about:blank',
  ], {windowsHide: true, stdio: 'ignore'});
  chrome.on('error', error => {errors.push(error.message);});
  await waitUntil(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok);
  const target = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, {method: 'PUT'})).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const handler = pending.get(message.id);
      if (handler) {pending.delete(message.id); message.error ? handler.fail(new Error(message.error.message)) : handler.done(message.result);}
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') consoleErrors.push(message.params.args.map(arg => arg.value || arg.description || '').join(' '));
    else if (message.method === 'Fetch.requestPaused') {
      const params = message.params;
      requests.push(params.request.url);
      if (localRequest(params.request.url)) command('Fetch.continueRequest', {requestId: params.requestId}).catch(error => errors.push(error.message));
      else {
        blocked.push(params.request.url);
        command('Fetch.failRequest', {requestId: params.requestId, errorReason: 'InternetDisconnected'}).catch(error => errors.push(error.message));
      }
    }
  });
  await new Promise((done, fail) => {socket.addEventListener('open', done, {once: true}); socket.addEventListener('error', fail, {once: true});});
  await command('Runtime.enable'); await command('Page.enable'); await command('Network.enable');
  await command('Network.setCacheDisabled', {cacheDisabled: true});
  await command('Network.setBypassServiceWorker', {bypass: true});
  await command('Fetch.enable', {patterns: [{urlPattern: '*', requestStage: 'Request'}]});
  await command('Emulation.setDeviceMetricsOverride', {width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false});
  await command('Page.navigate', {url: origin});

  await waitUntil(() => evaluate(`document.getElementById('model-status')?.classList.contains('ready')`));
  await waitUntil(() => evaluate(`document.getElementById('train-button')?.disabled === false`));
  const readApi = async path => {
    const response=await fetch(origin+path);
    assert.equal(response.status,200,path);
    return response.json();
  };
  let approvedId, queryExampleId, firstRun, secondRun;
  async function waitTraining() {
    const training=await waitUntil(async()=>{
      const value=await readApi('/api/training');
      return ['succeeded','failed'].includes(value.status) ? value : false;
    },180000);
    assert.equal(training.status,'succeeded',training.message);
    await waitUntil(()=>evaluate(`document.getElementById('train-button').disabled === false`));
    return training;
  }
  await check('La interfaz muestra avance, cuatro responsables y cinco secciones',async()=>{
    assert.equal(await evaluate(`document.querySelectorAll('[data-view]').length`),5);
    assert.equal(await evaluate(`document.querySelectorAll('#active-author option').length`),4);
    assert.match(await evaluate(`document.querySelector('.prototype-heading').textContent`),/18 DE NOVIEMBRE DE 2026/);
    assert.equal(await evaluate(`document.getElementById('message-input').disabled`),false);
    assert.equal(await evaluate(`Boolean(document.querySelector('#export-examples,#import-file'))`),false);
  });
  await screenshot('workflow-desktop.png');
  await check('El chat mantiene tres turnos y guarda responsable y hora reales',async()=>{
    const before=Date.now();
    await sendChat('Mi celular no carga'); await sendChat('No'); await sendChat('Sí');
    assert.match(await evaluate(`document.getElementById('context-device').textContent`),/Celular/);
    const queries=(await readApi('/api/queries')).queries;
    assert.equal(queries.length,3);
    assert.ok(queries.every(row=>row.author==='alumno-a' && row.timestamp_kind==='recorded' && Date.parse(row.created_at)>=before));
    assert.equal(queries[0].timezone,'America/Mexico_City');
    await click('#new-chat');
    assert.equal(await evaluate(`document.getElementById('context-device').textContent`),'Por identificar');
    await sendChat('<img src=x onerror="window.workflowInjected=true">');
    assert.equal(await evaluate(`window.workflowInjected === true`),false);
    assert.equal(await evaluate(`document.querySelector('.message.user img') !== null`),false);
  });
  await check('Un ejemplo nuevo queda pendiente y puede editarse antes de aprobar',async()=>{
    await click('[data-view="teach"]');
    await fill('#example-text','mi laptop de pruebas abre demasiado lento las herramientas del taller escolar qa');
    await fill('#example-intent','rendimiento');
    await evaluate(`document.getElementById('example-form').requestSubmit()`);
    const example=await waitUntil(async()=>{
      const rows=(await readApi('/api/examples')).examples;
      return rows.find(row=>row.text.includes('taller escolar qa'));
    });
    approvedId=example.id; assert.equal(example.review_status,'pending');
    assert.ok(Number.isFinite(Date.parse(example.created_at)));
    await waitUntil(()=>evaluate(`Boolean(document.querySelector('.edit-example[data-id="${approvedId}"]'))`));
    await click(`.edit-example[data-id="${approvedId}"]`);
    await fill('#example-text','mi laptop de pruebas tarda mucho al abrir las herramientas de clase del taller qa');
    await evaluate(`document.getElementById('example-form').requestSubmit()`);
    await waitUntil(async()=>{
      const row=(await readApi('/api/examples')).examples.find(row=>row.id===approvedId);
      return row.text.includes('herramientas de clase') && row.review_status==='pending';
    });
  });
  await check('Los duplicados se rechazan y la aprobación controla los datos de entrenamiento',async()=>{
    await waitUntil(()=>evaluate(`document.getElementById('save-example').disabled === false`));
    await fill('#example-text','mi laptop de pruebas tarda mucho al abrir las herramientas de clase del taller qa');
    await fill('#example-intent','rendimiento');
    await evaluate(`document.getElementById('example-form').requestSubmit()`);
    await waitUntil(()=>evaluate(`/duplic|existe/i.test(document.getElementById('example-status').textContent)`));
    assert.equal((await readApi('/api/examples')).examples.length,1);
    await click(`.approve-example[data-id="${approvedId}"]`);
    await waitUntil(async()=>(await readApi('/api/examples')).examples.find(row=>row.id===approvedId)?.review_status==='approved');
    assert.equal(await evaluate(`Boolean(document.querySelector('.delete-example[data-id="${approvedId}"]'))`),false);
    const snapshot=await readApi('/api/examples');
    assert.equal(snapshot.approved_examples.length,1);
    assert.equal(snapshot.examples[0].reviewed_by,'alumno-a');
  });
  await check('Una consulta se transforma en pendiente y puede rechazarse sin borrarla',async()=>{
    await click('[data-view="chat"]'); await click('#new-chat');
    await fill('#active-author','alumno-b');
    await sendChat('mi consola se calienta cuando jugamos partidas largas en el taller de pruebas qa');
    await click('[data-view="queries"]');
    const query=(await readApi('/api/queries')).queries.find(row=>row.text.includes('partidas largas'));
    await waitUntil(()=>evaluate(`Boolean(document.querySelector('.review-query[data-id="${query.id}"]'))`));
    await click(`.review-query[data-id="${query.id}"]`);
    await fill('#review-intent','temperatura');
    await evaluate(`document.getElementById('review-form').requestSubmit()`);
    const example=await waitUntil(async()=>(await readApi('/api/examples')).examples.find(row=>row.source_query_id===query.id));
    queryExampleId=example.id; assert.equal(example.review_status,'pending');
    await click('[data-view="teach"]');
    await waitUntil(()=>evaluate(`Boolean(document.querySelector('.reject-example[data-id="${queryExampleId}"]'))`));
    await click(`.reject-example[data-id="${queryExampleId}"]`);
    await waitUntil(async()=>(await readApi('/api/examples')).examples.find(row=>row.id===queryExampleId)?.review_status==='rejected');
    const snapshot=await readApi('/api/examples'); assert.equal(snapshot.approved_examples.length,1); assert.equal(snapshot.examples.length,2);
  });
  await check('El panel muestra distribución, datos faltantes y prueba final reservada',async()=>{
    await click('[data-view="progress"]');
    const progress=await waitUntil(async()=>{
      const value=await readApi('/api/progress');
      return value.counts?.approved_additional===1 && value.counts.rejected===1 ? value : false;
    });
    await click('#refresh-progress');
    await waitUntil(()=>evaluate(`document.querySelectorAll('#progress-intents tr').length === 16`));
    assert.equal(progress.missing_examples_total,79); assert.equal(progress.final_test_size,0);
    assert.ok(progress.rubric.some(row=>row.status==='Pendiente de datos'));
    assert.equal(await evaluate(`document.querySelectorAll('#rubric-status .rubric-row').length > 0`),true);
  });
  await check('Entrenar crea una jornada real con dos algoritmos y mantiene el activo anterior',async()=>{
    await fill('#active-author','sergio'); await click('[data-view="teach"]');
    await waitUntil(()=>evaluate(`document.getElementById('train-button').disabled === false`));
    const before=Date.now(); await click('#train-button'); customTraining=await waitTraining();
    const history=await readApi('/api/versions');
    firstRun=history.versions.find(row=>row.status==='succeeded');
    assert.ok(firstRun); assert.equal(firstRun.approval_status,'provisional'); assert.equal(history.active_id,null);
    assert.equal(firstRun.counts.additional,1); assert.equal(firstRun.counts.total,241);
    assert.ok(Date.parse(firstRun.created_at)>=before);
    assert.deepEqual(Object.keys(firstRun.models).sort(),['logistic_regression','naive_bayes']);
    for (const metrics of Object.values(firstRun.models)) for (const field of ['accuracy','precision_macro','recall_macro','f1_macro']) assert.ok(Number.isFinite(metrics[field]),field);
  });
  await check('La vista previa muestra resultados y matrices sin activar el modelo',async()=>{
    await click('[data-view="versions"]');
    await waitUntil(()=>evaluate(`Boolean(document.querySelector('.view-version[data-id="${firstRun.id}"]'))`));
    await click(`.view-version[data-id="${firstRun.id}"]`);
    await waitUntil(()=>evaluate(`document.querySelectorAll('#version-detail .matrix-details').length===2`));
    assert.equal(await evaluate(`document.querySelectorAll('#version-detail .observed-error').length >= 3`),true);
    assert.equal(await evaluate(`document.querySelector('#version-detail .final-test-button').disabled`),true);
    await click(`.version-row[data-id="${firstRun.id}"] .preview-version`);
    await waitUntil(()=>evaluate(`document.getElementById('chat-model-label').textContent.includes('Vista previa')`));
    assert.equal((await readApi('/api/versions')).active_id,null);
    await click('#restore-active-model');
    await waitUntil(()=>evaluate(`document.getElementById('model-status').classList.contains('ready') && !document.getElementById('chat-model-label').textContent.includes('Vista previa')`));
  });
  await check('La activación aprobada persiste y una segunda jornada conserva la primera',async()=>{
    await click('[data-view="versions"]');
    await click(`.version-row[data-id="${firstRun.id}"] .activate-version`);
    await waitUntil(async()=>(await readApi('/api/versions')).active_id===firstRun.id);
    await waitUntil(()=>evaluate(`document.getElementById('model-status').classList.contains('ready') && document.getElementById('chat-model-label').textContent.includes('Jornada ${firstRun.journey}')`));
    const firstModel=await (await fetch(`${origin}/api/versions/${firstRun.id}/model.json`)).text();
    await click('[data-view="teach"]');
    await waitUntil(()=>evaluate(`document.getElementById('train-button').disabled === false`));
    await click('#train-button'); await waitTraining();
    const history=await readApi('/api/versions');
    secondRun=history.versions.find(row=>row.id!==firstRun.id && row.status==='succeeded');
    assert.ok(secondRun); assert.equal(secondRun.journey,firstRun.journey+1);
    assert.equal(history.active_id,firstRun.id);
    assert.equal(await (await fetch(`${origin}/api/versions/${firstRun.id}/model.json`)).text(),firstModel);
    assert.equal(secondRun.approval_status,'provisional');
    assert.equal(secondRun.comparison.previous_id,firstRun.id);
  });
  await check('Se puede activar la segunda versión y recuperar la anterior',async()=>{
    await click('[data-view="versions"]');
    await waitUntil(()=>evaluate(`Boolean(document.querySelector('.version-row[data-id="${secondRun.id}"] .activate-version'))`));
    await click(`.version-row[data-id="${secondRun.id}"] .activate-version`);
    await waitUntil(async()=>(await readApi('/api/versions')).active_id===secondRun.id);
    await waitUntil(()=>evaluate(`Boolean(document.querySelector('.version-row[data-id="${firstRun.id}"] .activate-version')) && document.getElementById('model-status').classList.contains('ready')`));
    await click(`.version-row[data-id="${firstRun.id}"] .activate-version`);
    await waitUntil(async()=>(await readApi('/api/versions')).active_id===firstRun.id);
    await command('Page.reload',{ignoreCache:true});
    await waitUntil(()=>evaluate(`document.getElementById('model-status').classList.contains('ready')`));
    assert.match(await evaluate(`document.getElementById('chat-model-label').textContent`),new RegExp(`Jornada ${firstRun.journey}`));
    const examples=await readApi('/api/examples'); assert.equal(examples.examples.length,2); assert.equal(examples.approved_examples.length,1);
    await sendChat('Mi computadora no prende');
    const queries=(await readApi('/api/queries')).queries;
    assert.ok(queries.some(row=>row.model.kind==='version' && row.model.version_id===firstRun.id));
  });
  await click('[data-view="versions"]');
  await click(`.view-version[data-id="${secondRun.id}"]`);
  await screenshot('workflow-jornadas.png');
  await click('[data-view="progress"]'); await screenshot('workflow-progreso.png');
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await check('Las cinco secciones caben en móvil sin desbordar',async()=>{
    for (const view of ['chat','queries','teach','versions','progress']) {
      await click(`[data-view="${view}"]`); await delay(150);
      assert.equal(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`),true,view);
    }
  });
  await screenshot('workflow-mobile.png');
  await check('La interfaz termina sin excepciones ni peticiones externas',async()=>{
    assert.deepEqual(errors,[]); assert.deepEqual(consoleErrors,[]); assert.deepEqual(blocked,[]);
  });
  console.log(`${results.length} comprobaciones aprobadas, incluidas dos jornadas reales en almacenamiento temporal.`);
} catch (error) {
  failure = error;
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  await mkdir(output, {recursive: true});
  await writeFile(resolve(output, 'workflow-browser-results.json'), JSON.stringify({
    browser: 'Chrome headless/CDP', origin, generated_at: new Date().toISOString(), trainRequested,
    isolatedData: true, modelDays: manifest?.days?.length,
    passed: results.filter(row => row.passed).length, failed: results.filter(row => !row.passed).length,
    results, errors, consoleErrors, externalRequests: blocked, requestCount: requests.length,
    customTraining, failure: failure?.message || null,
    screenshots: ['workflow-desktop.png', 'workflow-jornadas.png', 'workflow-progreso.png', 'workflow-mobile.png'],
    desktop: {width: 1440, height: 1000}, mobile: {width: 390, height: 844},
  }, null, 2) + '\n');
  socket?.close(); await stop(chrome); await stop(server);
  assert.equal(dirname(workspace), resolve(tmpdir()));
  assert.ok(workspace.startsWith(join(tmpdir(), 'yinyan-workflow-qa-')));
  // Chrome deja archivos brevemente abiertos incluso después de terminar su proceso principal.
  await rm(workspace, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
}
