/** Persistencia y reentrenamiento para el taller local. Sin servicios externos. */
import {readFile, writeFile, mkdir, rename, stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {createTeamStore} from './team-store.mjs';

const MAX_BYTES = 1024 * 1024;
const fail = (message, status = 400) => Object.assign(new Error(message), {status});

export function createStudentApi({project, origin}) {
  const dataDir = resolve(process.env.YINYAN_DATA_DIR || resolve(project, 'data/local'));
  const store = createTeamStore({project,runtime:dataDir});
  const statusFile = resolve(dataDir, 'training-status.json');
  let task = null;
  let queue = Promise.resolve();
  let state = {status:'idle', message:'Todavía no has entrenado con ejemplos propios.'};
  let initialized;

  async function atomicJson(path, value) {
    await mkdir(dataDir, {recursive:true});
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
    await rename(temporary, path);
  }
  async function load() {
    return store.snapshot();
  }
  async function initialize() {
    if (!initialized) initialized = (async () => {
      try {
        const stored = JSON.parse(await readFile(statusFile, 'utf8'));
        if (stored.status === 'running') state = {status:'failed', message:'El entrenamiento anterior se interrumpió. Puedes intentarlo de nuevo.'};
        else if (stored.status === 'succeeded' && existsSync(resolve(dataDir, 'custom-model.json'))) state = stored;
        else if (stored.status === 'failed' && typeof stored.message === 'string') state = stored;
      } catch {/* La primera apertura no tiene estado guardado. */}
    })();
    await initialized;
  }
  async function body(req) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw fail('Envía los datos como application/json.', 415);
    if (Number(req.headers['content-length'] || 0) > MAX_BYTES) throw fail('El archivo es demasiado grande (máximo 1 MB).', 413);
    let length = 0;
    const chunks = [];
    for await (const chunk of req) {
      length += chunk.length;
      if (length > MAX_BYTES) throw fail('El archivo es demasiado grande (máximo 1 MB).', 413);
      chunks.push(chunk);
    }
    try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
    catch {throw fail('El contenido no es un JSON válido.');}
  }
  function sameOrigin(req) {
    const expectedPort = new URL(origin).port;
    try {
      const host = new URL(`http://${req.headers.host}`);
      if (!['127.0.0.1','localhost'].includes(host.hostname) || host.port !== expectedPort) return false;
      if (req.headers.origin && req.headers.origin !== host.origin) return false;
      if (req.headers['sec-fetch-site'] === 'cross-site') return false;
      return true;
    } catch {return false;}
  }
  function json(req, res, status, value, extra = {}) {
    const content = Buffer.from(JSON.stringify(value));
    res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Content-Length':content.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra});
    res.end(req.method === 'HEAD' ? undefined : content);
  }
  async function trainingState() {
    await initialize();
    const {revision} = await load();
    return {...state, revision, stale:Boolean(state.result && state.trained_revision !== revision)};
  }
  async function train() {
    await initialize();
    if (task) throw fail('Ya hay un entrenamiento en curso.', 409);
    const snapshot = await load();
    if (!snapshot.examples.length) throw fail('Agrega al menos un ejemplo propio antes de reentrenar.');
    const input = resolve(dataDir, 'training-input.json');
    await atomicJson(input, {examples:snapshot.examples});
    const python = process.env.YINYAN_PYTHON || (existsSync(resolve(project,'runtime/python/python.exe')) ? resolve(project,'runtime/python/python.exe') : 'python');
    state = {status:'running', message:'Entrenando con el día 15 y tus ejemplos revisados…', trained_revision:snapshot.revision};
    await atomicJson(statusFile, state);
    const child = spawn(python, ['-m','src.simulation','--custom','--examples-file',input,'--output-dir',dataDir], {cwd:project, env:{...process.env,PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
    task = child;
    let output = '';
    const collect = chunk => {output = (output + chunk.toString('utf8')).slice(-12000);};
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    let finished = false;
    const timer = setTimeout(() => {output += '\nEl entrenamiento superó el tiempo de espera.'; child.kill();}, 120000);
    timer.unref();
    async function finish(error, code) {
      if (finished) return;
      finished = true; clearTimeout(timer);
      try {
        if (error || code !== 0) throw error || new Error(output.trim().split('\n').slice(-3).join(' ').slice(-600) || 'Python no pudo completar el entrenamiento.');
        const result = JSON.parse(await readFile(resolve(dataDir,'custom-result.json'), 'utf8'));
        await stat(resolve(dataDir,'custom-model.json'));
        if (!Number.isFinite(result.accuracy) || result.accuracy < 0 || result.accuracy > 1) throw new Error('El entrenamiento no produjo métricas válidas.');
        result.trained_at ||= new Date().toISOString();
        state = {status:'succeeded',message:'Entrenamiento terminado. Ya puedes probar tu modelo.',trained_revision:snapshot.revision,trained_at:result.trained_at,result};
      } catch (failure) {
        state = {status:'failed',message:failure.code === 'ENOENT' ? 'No se encontró Python. Usa la copia portable completa o configura Python con las dependencias del proyecto.' : `No se pudo entrenar: ${failure.message}`};
      }
      try {await atomicJson(statusFile,state);} catch {state = {status:'failed',message:'El entrenamiento terminó, pero no se pudo guardar su estado.'};}
      task = null;
    }
    child.once('error', error => {void finish(error);});
    child.once('close', code => {void finish(null,code);});
    return trainingState();
  }

  async function route(req, res, pathname) {
    if (pathname !== '/simulation/custom-model.json' && !pathname.startsWith('/api/')) return false;
    try {
      if (!sameOrigin(req)) throw fail('Esta operación solo está disponible desde la página local.', 403);
      if (pathname === '/simulation/custom-model.json') {
        if (!['GET','HEAD'].includes(req.method)) {json(req,res,405,{error:'Método no permitido.'},{Allow:'GET, HEAD'}); return true;}
        let content;
        try {content = await readFile(resolve(dataDir,'custom-model.json'));} catch {throw fail('Todavía no hay un modelo propio. Reentrena primero.',404);}
        res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Content-Length':content.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
        res.end(req.method === 'HEAD' ? undefined : content); return true;
      }
      if (pathname === '/api/examples') {
        if (['GET','HEAD'].includes(req.method)) {json(req,res,200,await load()); return true;}
        if (!['POST','PUT'].includes(req.method)) {json(req,res,405,{error:'Método no permitido.'},{Allow:'GET, HEAD, POST, PUT'});return true;}
        const input = await body(req);
        const result = req.method === 'POST' ? await store.createExample(input) : await store.importExamples(input);
        json(req,res,req.method === 'POST' ? 201 : 200,result);return true;
      }
      if (pathname.startsWith('/api/examples/')) {
        if (req.method !== 'DELETE') {json(req,res,405,{error:'Método no permitido.'},{Allow:'DELETE'});return true;}
        const id = pathname.slice('/api/examples/'.length);
        const data = Number(req.headers['content-length'] || 0) > 0 ? await body(req) : {};
        json(req,res,200,await store.deleteExample(id,data));return true;
      }
      if (pathname === '/api/queries') {
        if (['GET','HEAD'].includes(req.method)) json(req,res,200,await store.queries());
        else if (req.method === 'POST') {
          const result = await store.createQuery(await body(req)); json(req,res,result.status,result.value);
        } else json(req,res,405,{error:'Método no permitido.'},{Allow:'GET, HEAD, POST'});
        return true;
      }
      if (pathname.startsWith('/api/queries/') && pathname.endsWith('/example')) {
        if (req.method !== 'POST') {json(req,res,405,{error:'Método no permitido.'},{Allow:'POST'});return true;}
        const id = pathname.slice('/api/queries/'.length,-'/example'.length);
        const result = await store.reviewQuery(id,await body(req));
        json(req,res,result.status,result.value);return true;
      }
      if (pathname === '/api/training' && ['GET','HEAD'].includes(req.method)) {json(req,res,200,await trainingState());return true;}
      if (pathname === '/api/train') {
        if (req.method !== 'POST') {json(req,res,405,{error:'Método no permitido.'},{Allow:'POST'});return true;}
        await body(req);json(req,res,202,await train());return true;
      }
      throw fail('Ruta local no encontrada.',404);
    } catch (error) {json(req,res,error.status || 500,{error:error.status ? error.message : 'No se pudo completar la operación local. Revisa permisos y espacio disponible.'});}
    return true;
  }
  return {
    handle(req,res,pathname) {
      if (pathname !== '/simulation/custom-model.json' && !pathname.startsWith('/api/')) return Promise.resolve(false);
      // Las operaciones se completan en orden incluso con dos pestañas abiertas.
      const next = queue.then(() => route(req,res,pathname));
      queue = next.catch(() => {});
      return next;
    },
    close() {if (task) task.kill();}
  };
}
