/** Comprueba el guardado del chat con navegador, puertos y datos temporales. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync} from 'node:fs';
import {cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const projectArgument = process.argv.find(value => value.startsWith('--project='));
const project = projectArgument ? resolve(projectArgument.slice('--project='.length)) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browserPath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const python = process.env.YINYAN_PYTHON || resolve(project, 'runtime/python/python.exe');
const pendingKey = 'yinyan-pending-queries-v1';
const delay = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const readJson = path => readFile(path, 'utf8').then(JSON.parse);
const catalog = await readJson(resolve(project, 'data/training/training_history.json'));
const shippedActive = await readJson(resolve(project, 'data/training/active.json'));
assert.ok(existsSync(browserPath), 'Configura CHROME_PATH con el ejecutable de Chrome para esta comprobación.');
assert.ok(shippedActive.active_id, 'La comprobación necesita una jornada aprobada de referencia.');

async function waitUntil(check, detail, timeout = 20000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {last = await check(); if (last) return last;}
    catch (error) {last = error.message;}
    await delay(75);
  }
  throw new Error(`${detail}. Último resultado: ${String(last)}`);
}

async function freePort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((done, fail) => probe.close(error => error ? fail(error) : done()));
  return port;
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const closed = once(child, 'close');
  child.kill();
  await closed;
}

async function exercise(name, command, arguments_) {
  const workspace = await mkdtemp(join(tmpdir(), 'yinyan-query-browser-'));
  const runtime = resolve(workspace, 'local'), training = resolve(workspace, 'training');
  const port = await freePort(), cdpPort = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const env = {...process.env};
  for (const key of Object.keys(env)) if (key.startsWith('YINYAN_')) delete env[key];
  Object.assign(env, {PORT: String(port), YINYAN_DATA_DIR: runtime, YINYAN_TEAM_DIR: resolve(workspace, 'team'),
    YINYAN_TRAINING_DIR: training, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1'});
  let server, chrome, socket, serverError, chromeError, log = '', nextId = 0;
  const pending = new Map(), posted = [], errors = [];
  let passed = 0;

  function cdp(method, params = {}) {
    return new Promise((done, fail) => {
      const id = ++nextId;
      const timer = setTimeout(() => {pending.delete(id); fail(new Error(`Chrome no respondió: ${method}`));}, 15000);
      pending.set(id, {done: result => {clearTimeout(timer); done(result);}, fail: error => {clearTimeout(timer); fail(error);}});
      socket.send(JSON.stringify({id, method, params}));
    });
  }

  async function evaluate(expression) {
    const result = await cdp('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }

  async function queries() {
    const response = await fetch(`${origin}/api/queries`, {signal: AbortSignal.timeout(5000)});
    const value = await response.json();
    assert.equal(response.status, 200, JSON.stringify(value));
    return value.queries;
  }

  async function load(seed = []) {
    const injection = await cdp('Page.addScriptToEvaluateOnNewDocument', {source:
      `if(location.origin===${JSON.stringify(origin)}){localStorage.setItem('yinyan-active-author','sergio');localStorage.setItem(${JSON.stringify(pendingKey)},${JSON.stringify(JSON.stringify(seed))});}`});
    try {
      await cdp('Page.navigate', {url: origin});
      await waitUntil(() => evaluate(`document.getElementById('model-status')?.classList.contains('ready') && !document.getElementById('message-input').disabled`), `${name}: no se pudo cargar el chat`);
    } finally {await cdp('Page.removeScriptToEvaluateOnNewDocument', {identifier: injection.identifier});}
  }

  async function send(text, versionId) {
    await evaluate(`(()=>{document.getElementById('message-input').value=${JSON.stringify(text)};document.getElementById('chat-form').requestSubmit();})()`);
    await waitUntil(() => evaluate(`!document.getElementById('send-button').disabled`), `${name}: el envío no terminó`);
    const payload = posted.findLast(row => row.text === text);
    assert.ok(payload, `${name}: el navegador debe enviar la consulta.`);
    assert.deepEqual(payload.model, {kind: 'version', version_id: versionId}, 'Una consulta nueva envía la versión del modelo que respondió.');
    const row = await waitUntil(async () => (await queries()).find(item => item.id === payload.id), `${name}: la consulta debe quedar guardada`);
    assert.deepEqual(row.model, payload.model);
    assert.equal(row.response, payload.response);
    assert.equal(await evaluate(`document.getElementById('query-save-error').hidden`), true);
    assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(pendingKey)})||'[]')`), []);
    return row;
  }

  async function check(description, work) {
    await work(); passed++;
    console.log(`OK ${name}: ${description}`);
  }

  try {
    server = spawn(command, [...arguments_, resolve(project, `scripts/serve.${name === 'Node' ? 'mjs' : 'py'}`)], {
      cwd: project, env, windowsHide: true, stdio: 'pipe',
    });
    server.on('error', error => {serverError = error;});
    server.stdout.on('data', part => {log += part;}); server.stderr.on('data', part => {log += part;});
    await waitUntil(async () => {
      if (serverError) throw serverError;
      if (server.exitCode !== null) throw new Error(log);
      return (await fetch(`${origin}/health`, {signal: AbortSignal.timeout(500)})).ok;
    }, `${name}: no inició el servidor de prueba`);

    chrome = spawn(browserPath, ['--headless=new', `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${resolve(workspace, 'chrome')}`, '--no-first-run', '--no-default-browser-check',
      '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--disable-component-update',
      '--disable-sync', '--disable-default-apps', '--metrics-recording-only', '--no-pings', 'about:blank'],
    {windowsHide: true, stdio: 'ignore'});
    chrome.on('error', error => {chromeError = error;});
    await waitUntil(async () => {
      if (chromeError) throw chromeError;
      return (await fetch(`http://127.0.0.1:${cdpPort}/json/version`, {signal: AbortSignal.timeout(500)})).ok;
    }, `${name}: no inició Chrome`);
    const target = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, {method: 'PUT'})).json();
    socket = new WebSocket(target.webSocketDebuggerUrl);
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const handler = pending.get(message.id);
        if (handler) {pending.delete(message.id); message.error ? handler.fail(new Error(message.error.message)) : handler.done(message.result);}
      } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      else if (message.method === 'Network.requestWillBeSent') {
        const request = message.params.request;
        if (request.method === 'POST' && request.url === `${origin}/api/queries` && request.postData) posted.push(JSON.parse(request.postData));
      }
    });
    await new Promise((done, fail) => {socket.addEventListener('open', done, {once: true}); socket.addEventListener('error', fail, {once: true});});
    await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
    await cdp('Network.setCacheDisabled', {cacheDisabled: true});

    await check('la base inicial guarda una consulta con su UUID', async () => {
      await load();
      await send('Mi celular no carga', catalog.references.base_id);
    });
    await check('una etapa histórica guarda el UUID de esa etapa', async () => {
      await evaluate(`(()=>{const select=document.getElementById('day-select');select.value='8';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await waitUntil(() => evaluate(`document.getElementById('model-status').classList.contains('ready') && document.getElementById('day-select').value==='8' && !document.getElementById('message-input').disabled`), `${name}: no cargó la etapa 8`);
      await send('Mi laptop no prende', catalog.references.stages['8']);
    });
    await check('restaurar el modelo activo bloquea el envío mientras verifica su versión', async () => {
      await evaluate(`(()=>{window.__queryOriginalFetch=window.fetch;window.fetch=(...args)=>args[0]==='/api/models/active'?new Promise((done,fail)=>{window.__queryReleaseFetch=()=>window.__queryOriginalFetch(...args).then(done,fail);}):window.__queryOriginalFetch(...args);document.getElementById('restore-active-model').click();})()`);
      try {
        await waitUntil(() => evaluate(`typeof window.__queryReleaseFetch==='function'`), `${name}: no consultó el modelo activo`);
        assert.equal(await evaluate(`document.getElementById('message-input').disabled && document.getElementById('send-button').disabled`), true);
      } finally {
        await evaluate(`(()=>{window.fetch=window.__queryOriginalFetch;const release=window.__queryReleaseFetch;delete window.__queryReleaseFetch;if(release)release();})()`);
      }
      await waitUntil(() => evaluate(`document.getElementById('model-status').classList.contains('ready') && !document.getElementById('message-input').disabled`), `${name}: no terminó de restaurar el modelo`);
    });

    // Una versión activa distinta permite detectar atribuciones incorrectas de la cola anterior.
    await cp(resolve(project, 'data/training/runs', shippedActive.active_id), resolve(training, 'runs', shippedActive.active_id), {recursive: true});
    await mkdir(training, {recursive: true});
    await writeFile(resolve(training, 'active.json'), JSON.stringify(shippedActive));
    const legacy = {id: randomUUID(), session_id: 'sesion-pendiente-anterior', author: 'raynier',
      text: 'El telefono parpadea al intentar abrirlo', response: '¿Parpadea la pantalla o se reinicia el teléfono?',
      intent: 'pantalla', accepted: false, model: {kind: 'simulation', day: 15}, resolution: 'clarification'};
    let originalDate;
    await check('recupera la consulta pendiente sin cambiar su modelo ni contenido', async () => {
      await load([legacy]);
      const row = await waitUntil(async () => (await queries()).find(item => item.id === legacy.id), `${name}: no recuperó la consulta pendiente`);
      for (const key of ['id', 'session_id', 'author', 'text', 'response', 'intent', 'accepted', 'resolution']) assert.deepEqual(row[key], legacy[key]);
      assert.deepEqual(row.model, {kind: 'version', version_id: catalog.references.stages['15']});
      assert.notEqual(row.model.version_id, shippedActive.active_id, 'La cola no se atribuye al modelo activo posterior.');
      await waitUntil(() => evaluate(`document.getElementById('query-save-error').hidden && !localStorage.getItem(${JSON.stringify(pendingKey)})`), `${name}: la cola recuperada no se limpió`);
      originalDate = row.created_at;
    });
    await check('reintentar la misma consulta conserva un único registro y su fecha', async () => {
      await load([legacy]);
      await waitUntil(() => evaluate(`document.getElementById('query-save-error').hidden && !localStorage.getItem(${JSON.stringify(pendingKey)})`), `${name}: el reintento no terminó`);
      const rows = (await queries()).filter(row => row.id === legacy.id);
      assert.equal(rows.length, 1); assert.equal(rows[0].created_at, originalDate);
    });
    await check('una consulta nueva utiliza la jornada activa aprobada', async () => {
      await send('Mi consola no tiene sonido', shippedActive.active_id);
    });
    await check('una versión anterior sin equivalencia permanece pendiente', async () => {
      const unknown = {...legacy, id: randomUUID(), model: {kind: 'custom', revision: 'revision-sin-equivalencia'}};
      await load([unknown]);
      await waitUntil(() => posted.some(row => row.id === unknown.id), `${name}: no intentó recuperar el pendiente anterior`);
      await waitUntil(() => evaluate(`!document.getElementById('query-save-error').hidden && !document.getElementById('retry-queries').disabled`), `${name}: debe mostrar el pendiente sin equivalencia`);
      assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(pendingKey)}))`), [unknown]);
      assert.equal((await queries()).some(row => row.id === unknown.id), false);
    });
    await check('un pendiente sin equivalencia no bloquea otras consultas recuperables', async () => {
      const unknown = {...legacy, id: randomUUID(), model: {kind: 'custom', revision: 'revision-sin-equivalencia'}};
      const recoverable = {...legacy, id: randomUUID(), model: {kind: 'simulation', day: 8}};
      await load([unknown, recoverable]);
      const row = await waitUntil(async () => (await queries()).find(item => item.id === recoverable.id), `${name}: otro pendiente bloqueó una consulta recuperable`);
      assert.deepEqual(row.model, {kind: 'version', version_id: catalog.references.stages['8']});
      await waitUntil(() => evaluate(`!document.getElementById('retry-queries').disabled`), `${name}: el reintento no terminó`);
      assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(pendingKey)}))`), [unknown]);
      assert.equal((await queries()).some(item => item.id === unknown.id), false);
    });
    assert.deepEqual(errors, [], 'La página debe terminar sin excepciones de JavaScript.');
    return passed;
  } finally {
    socket?.close();
    for (const handler of pending.values()) handler.fail(new Error('Se cerró la comprobación.'));
    pending.clear();
    await stop(chrome); await stop(server);
    const target = await realpath(workspace);
    assert.equal(dirname(target), await realpath(tmpdir()));
    assert.ok(basename(target).startsWith('yinyan-query-browser-'));
    assert.equal(resolve(target), resolve(workspace));
    await rm(target, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
  }
}

let total = 0;
if (!process.argv.includes('--python-only')) total += await exercise('Node', process.execPath, []);
if (!process.argv.includes('--node-only')) total += await exercise('Python', python, ['-B']);
console.log(`${total} comprobaciones de guardado aprobadas; datos y perfiles aislados del proyecto.`);
