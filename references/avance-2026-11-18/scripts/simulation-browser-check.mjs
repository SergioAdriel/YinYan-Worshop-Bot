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
const workspace = await mkdtemp(join(tmpdir(), 'yinyan-simulation-qa-'));
const dataDirectory = join(workspace, 'student-data');
const profile = join(workspace, 'chrome-profile');
const browserPath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const cdpPort = Number(process.env.YINYAN_QA_CDP_PORT || 9239);
const serverPort = Number(process.env.YINYAN_QA_PORT || 4189);
const origin = `http://127.0.0.1:${serverPort}`;
const trainRequested = process.argv.includes('--train');
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

  // Los selectores de la práctica se mantienen explícitos para detectar cambios de interfaz.
  await waitUntil(() => evaluate(`document.getElementById('model-status')?.classList.contains('ready')`));
  await check('La página local ofrece chat, consultas y entrenamiento sin intercambio de JSON', async () => {
    assert.equal(await evaluate(`document.querySelectorAll('[data-view]').length`), 3);
    for (const view of ['chat', 'queries', 'teach']) assert.equal(await evaluate(`Boolean(document.querySelector('[data-view="${view}"]'))`), true);
    assert.equal(await evaluate(`document.getElementById('message-input').disabled`), false);
    assert.equal(await evaluate(`Boolean(document.querySelector('#export-examples, #import-file, [download*="json"]'))`), false);
    assert.equal(await evaluate(`document.querySelectorAll('#active-author option').length`), 2);
  });
  await screenshot('simulation-desktop.png');

  await check('Los quince días usan modelos reales distintos y permiten volver al día 15', async () => {
    assert.equal(await evaluate(`document.getElementById('day-select').querySelectorAll('option').length`), 15);
    await fill('#day-select', '1');
    await waitUntil(() => requests.some(url => /day-01\.json(?:$|\?)/.test(url)));
    await waitUntil(() => evaluate(`document.getElementById('model-status')?.classList.contains('ready')`));
    await fill('#day-select', '15');
    await waitUntil(() => requests.some(url => /day-15\.json(?:$|\?)/.test(url)));
    await waitUntil(() => evaluate(`document.getElementById('model-status')?.classList.contains('ready')`));
  });

  await check('El chat responde y presenta el texto del alumno sin ejecutar HTML', async () => {
    await fill('#active-author', 'alumno-a');
    const before = await evaluate(`document.querySelectorAll('.message.assistant').length`);
    await fill('#message-input', 'mi cel no carga desde ayer');
    await evaluate(`document.getElementById('chat-form').requestSubmit()`);
    await waitUntil(() => evaluate(`document.querySelectorAll('.message.assistant').length > ${before} && !document.getElementById('message-input').disabled`));
    await fill('#message-input', '<img src=x onerror="window.simulationInjected=true">');
    await evaluate(`document.getElementById('chat-form').requestSubmit()`);
    await waitUntil(() => evaluate(`document.querySelectorAll('.message.assistant').length > ${before + 1} && !document.getElementById('message-input').disabled`));
    assert.equal(await evaluate(`window.simulationInjected === true`), false);
    assert.equal(await evaluate(`document.querySelector('.message.user img') !== null`), false);
  });

  await check('Día 8: reinicios y parpadia piden aclaración, las opciones avanzan y no hay bucle', async () => {
    await fill('#day-select', '8');
    await waitUntil(() => evaluate(`document.getElementById('model-status').classList.contains('ready') && document.getElementById('chat-model-label').textContent.includes('Día 8')`));
    const first = await sendChat('Hola mi telefono se apaga y se prende');
    assert.match(first, /reinicia.*pantalla/i);
    await sendChat('Se apaga y se prende, es un ipone');
    assert.equal(await evaluate(`document.getElementById('context-device').textContent`), 'Celular');
    const choose = async text => {
      const before = await evaluate(`document.querySelectorAll('.message.assistant').length`);
      await evaluate(`(()=>{const option=Array.from(document.querySelectorAll('#suggestions button')).find(button=>button.textContent===${JSON.stringify(text)});if(!option)throw new Error('Falta opción de aclaración');option.click();})()`);
      await waitUntil(() => evaluate(`document.querySelectorAll('.message.assistant').length > ${before} && !document.getElementById('message-input').disabled`));
    };
    await choose('Se reinicia y sale el logo');
    assert.match(await evaluate(`document.getElementById('context-issue').textContent`), /software|sistema/i);
    await sendChat('Sí');
    const advice = await sendChat('Sí');
    assert.match(advice, /reinici|respalda/i);
    assert.doesNotMatch(advice, /enchufe|cargador/i);
    await click('#new-chat');
    const replies = [];
    for (const text of ['mi celular parpadia cuando lo prendo para abrirlo', 'mi telefono parpadia', 'mi telefono parpadea', 'se prende y se apaga mi telefono']) replies.push(await sendChat(text));
    assert.ok(new Set(replies).size > 1);
    assert.equal(await evaluate(`document.querySelector('.message.assistant:last-child a[href*="instagram.com"]') !== null`), true);
    await choose('Solo parpadea la pantalla');
    assert.match(await evaluate(`document.getElementById('context-issue').textContent`), /pantalla/i);
    assert.equal(await evaluate(`document.getElementById('context-device').textContent`), 'Celular');
    await fill('#day-select', '15');
    await waitUntil(() => evaluate(`document.getElementById('model-status').classList.contains('ready') && document.getElementById('chat-model-label').textContent.includes('Día 15')`));
  });

  await check('Las consultas se guardan con autor y fecha real de México y sobreviven a recargar', async () => {
    const start = Date.now();
    await fill('#active-author', 'alumno-b');
    await sendChat('mi telefono pierde el wifi al jugar consulta de bitacora qa');
    const query = await waitUntil(async () => {
      const state = await (await fetch(`${origin}/api/queries`)).json();
      return state.queries.find(row => row.text.includes('consulta de bitacora qa'));
    });
    assert.equal(query.author, 'alumno-b');
    assert.equal(query.timezone, 'America/Mexico_City');
    assert.equal(query.timestamp_kind, 'recorded');
    assert.ok(Date.parse(query.created_at) >= start && Date.parse(query.created_at) <= Date.now());
    assert.equal(query.reviewed, false);
    assert.equal((await (await fetch(`${origin}/api/examples`)).json()).examples.length, 0,
      'El chat no incorpora automáticamente sus propias predicciones al entrenamiento.');
    await command('Page.reload', {ignoreCache: true});
    await waitUntil(() => evaluate(`document.getElementById('model-status')?.classList.contains('ready')`));
    await click('[data-view="queries"]');
    await waitUntil(() => evaluate(`document.getElementById('query-history')?.textContent.includes('consulta de bitacora qa')`));
    const dates = await evaluate(`Array.from(document.querySelectorAll('#query-history time')).map(time=>({value:time.dateTime,text:time.textContent}))`);
    assert.ok(dates.some(time => time.value === query.created_at), 'La bitácora muestra un elemento time con la fecha conservada.');
    const date = dates.find(time => time.value === query.created_at);
    const mxHour = new Intl.DateTimeFormat('es-MX', {timeZone: 'America/Mexico_City', hour: '2-digit', hourCycle: 'h23'}).format(new Date(query.created_at));
    assert.ok(date.text.includes(mxHour), `La fecha visible corresponde a México: ${date.text}`);
    assert.ok(dates.every(time => time.text.trim()), 'Las consultas muestran una fecha legible.');
  });

  await check('Un estudiante revisa la consulta del otro antes de aprobarla para entrenamiento', async () => {
    const queries = (await (await fetch(`${origin}/api/queries`)).json()).queries;
    const query = queries.find(row => row.text.includes('consulta de bitacora qa'));
    await fill('#active-author', 'alumno-a');
    await click(`.review-query[data-id="${query.id}"]`);
    assert.equal(await evaluate(`document.getElementById('review-dialog').open`), true);
    assert.equal((await (await fetch(`${origin}/api/examples`)).json()).examples.length, 0);
    await fill('#review-text', 'mi telefono pierde el wifi al jugar ejemplo revisado qa');
    await fill('#review-intent', 'conexion');
    await click('#save-review');
    await waitUntil(async () => (await (await fetch(`${origin}/api/examples`)).json()).examples.length === 1);
    await waitUntil(() => evaluate(`!document.getElementById('review-dialog').open`));
    const state = await (await fetch(`${origin}/api/examples`)).json();
    assert.equal(state.examples[0].author, 'alumno-a');
    assert.equal(state.examples[0].source, 'review');
    assert.equal(state.examples[0].source_query_id, query.id);
    assert.equal(state.examples[0].intent, 'conexion');
    assert.equal((await (await fetch(`${origin}/api/queries`)).json()).queries.find(row => row.id === query.id).reviewed, true);
  });

  await click('[data-view="teach"]');
  await check('Los dos alumnos agregan ejemplos y el servidor los conserva al recargar', async () => {
    await fill('#example-text', 'mi compu no prende desde ayer qa');
    await fill('#example-intent', 'encendido'); await fill('#active-author', 'alumno-a');
    await evaluate(`document.getElementById('example-form').requestSubmit()`);
    await waitUntil(async () => (await (await fetch(`${origin}/api/examples`)).json()).examples.length === 2);
    await fill('#example-text', 'el cel no agarra el cargador qa');
    await fill('#example-intent', 'carga'); await fill('#active-author', 'alumno-b');
    await evaluate(`document.getElementById('example-form').requestSubmit()`);
    await waitUntil(async () => (await (await fetch(`${origin}/api/examples`)).json()).examples.length === 3);
    await command('Page.reload', {ignoreCache: true});
    await waitUntil(() => evaluate(`document.getElementById('model-status')?.classList.contains('ready')`));
    await click('[data-view="teach"]');
    await waitUntil(() => evaluate(`document.getElementById('saved-examples')?.textContent.includes('cargador qa')`));
  });

  if (trainRequested) {
    await check('Reentrenar produce un modelo real usando sólo el almacenamiento temporal', async () => {
      await click('#train-button');
      const state = await waitUntil(async () => {
        const current = await (await fetch(`${origin}/api/training`)).json();
        return ['succeeded', 'failed'].includes(current.status) ? current : false;
      }, 180000);
      customTraining = state;
      assert.equal(state.status, 'succeeded', state.message);
      assert.ok(state.result);
      assert.ok(Number.isFinite(Date.parse(state.trained_at)), 'El entrenamiento terminado tiene fecha real.');
      assert.equal(state.stale, false, 'El modelo recién entrenado usa la revisión actual.');
      const response = await fetch(`${origin}/simulation/custom-model.json`);
      assert.equal(response.status, 200);
      const model = await response.json();
      assert.equal(model.format_version, 1);
      assert.ok(model.features.length > 0);
      await waitUntil(() => evaluate(`document.getElementById('model-status')?.classList.contains('ready')`));
      await waitUntil(() => evaluate(`document.getElementById('use-custom-model')?.disabled === false`));
      await click('#use-custom-model');
      await waitUntil(() => evaluate(`document.getElementById('chat-model-label')?.textContent.includes('Mi modelo')`));
      assert.ok(requests.some(url => url.includes('/simulation/custom-model.json')));
      await command('Page.reload', {ignoreCache: true});
      await waitUntil(() => evaluate(`document.getElementById('model-status')?.classList.contains('ready')`));
      const restored = await (await fetch(`${origin}/api/training`)).json();
      assert.equal(restored.status, 'succeeded');
      assert.deepEqual(restored.result, state.result, 'Recargar mantiene el resultado del entrenamiento.');
      await click('[data-view="teach"]');
      await waitUntil(() => evaluate(`document.getElementById('use-custom-model')?.disabled === false`));
    });
  }

  await check('Eliminar un ejemplo actualiza la lista y el servidor', async () => {
    const before = await (await fetch(`${origin}/api/examples`)).json();
    const id = before.examples[0].id;
    await click(`.delete-example[data-id="${id}"]`);
    await waitUntil(async () => (await (await fetch(`${origin}/api/examples`)).json()).examples.length === 2);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(`.delete-example[data-id="${id}"]`)}) !== null`), false);
    if (trainRequested) {
      const stale = await (await fetch(`${origin}/api/training`)).json();
      assert.equal(stale.status, 'succeeded');
      assert.equal(stale.stale, true, 'Cambiar ejemplos distingue el modelo anterior del corpus actual.');
      assert.notEqual(stale.revision, stale.trained_revision);
      await waitUntil(() => evaluate(`/cambi|nuev|desactualiz|reentren/i.test(document.getElementById('training-status')?.textContent || '')`));
    }
  });

  await click('[data-view="queries"]');
  await evaluate(`document.getElementById('simulation-details').open = true`);
  await screenshot('simulation-days.png');
  await check('La evolución presenta los quince días y distingue objetivo de resultado', async () => {
    assert.equal(await evaluate(`document.querySelectorAll('[data-simulation-day]').length`), 15);
    assert.match(await evaluate(`document.getElementById('simulation-details').textContent`), /85/);
    assert.match(await evaluate(`document.getElementById('simulation-details').textContent`), /simulad/i);
  });

  await command('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true});
  await check('Chat, alimentación y resultados caben en móvil sin desbordar', async () => {
    for (const view of ['chat', 'queries', 'teach']) {
      await click(`[data-view="${view}"]`);
      await delay(120);
      assert.equal(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true, view);
    }
  });
  await click('[data-view="chat"]');
  await screenshot('simulation-mobile.png');
  await check('La interfaz termina sin excepciones ni recursos externos', async () => {
    assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(blocked, []);
    assert.ok(requests.some(url => url.includes('/simulation/manifest.json')));
    assert.ok(requests.some(url => url.includes('/api/examples')));
  });
  console.log(`${results.length} comprobaciones aprobadas; entrenamiento real: ${trainRequested ? 'sí, aislado' : 'no solicitado'}.`);
} catch (error) {
  failure = error;
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  await mkdir(output, {recursive: true});
  await writeFile(resolve(output, 'simulation-browser-results.json'), JSON.stringify({
    browser: 'Chrome headless/CDP', origin, simulated: true, trainRequested,
    isolatedData: true, modelDays: manifest?.days?.length,
    passed: results.filter(row => row.passed).length, failed: results.filter(row => !row.passed).length,
    results, errors, consoleErrors, externalRequests: blocked, requestCount: requests.length,
    customTraining, failure: failure?.message || null,
    screenshots: ['simulation-desktop.png', 'simulation-days.png', 'simulation-mobile.png'],
    desktop: {width: 1440, height: 1000}, mobile: {width: 390, height: 844},
  }, null, 2) + '\n');
  socket?.close(); await stop(chrome); await stop(server);
  assert.equal(dirname(workspace), resolve(tmpdir()));
  assert.ok(workspace.startsWith(join(tmpdir(), 'yinyan-simulation-qa-')));
  // Chrome deja archivos brevemente abiertos incluso después de terminar su proceso principal.
  await rm(workspace, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
}
