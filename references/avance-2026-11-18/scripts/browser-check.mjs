/** QA local con Chrome/CDP. Todas las peticiones externas de la pestaña se bloquean antes de navegar. */
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const scriptProject=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const root=resolve(process.env.YINYAN_QA_PROJECT||scriptProject);
const output=resolve(process.env.YINYAN_QA_OUTPUT||resolve(scriptProject,'reports'));
const browserPath=process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port=Number(process.env.YINYAN_QA_CDP_PORT||9227);
const serverPort=Number(process.env.YINYAN_QA_PORT||4173);
const origin=`http://127.0.0.1:${serverPort}`;
const profile=resolve(scriptProject,`../.runtime/chrome-qa-${port}`);
const downloadDirectory=resolve(profile,`qa-downloads-${Date.now()}`);
const probeURL='https://offline-check.invalid/__yinyan_offline_probe__';
const distPresent=existsSync(resolve(root,'dist'));
if(process.env.YINYAN_QA_REQUIRE_NO_DIST==='1')assert.equal(distPresent,false,'La extracción para QA debe carecer de dist/.');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const server=spawn(process.execPath,[resolve(root,'scripts/serve.mjs')],{cwd:root,env:{...process.env,PORT:String(serverPort)},windowsHide:true,stdio:'pipe'});
let serverLog='';server.stdout.on('data',chunk=>{serverLog+=chunk.toString();});server.stderr.on('data',chunk=>{serverLog+=chunk.toString();});
const chrome=spawn(browserPath,['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-gpu','--disable-extensions','--disable-background-networking','--disable-component-update','--disable-sync','--disable-default-apps','--metrics-recording-only','--no-pings','--hide-scrollbars','about:blank'],{windowsHide:true,stdio:'ignore'});
let socket;
let id=0;
const pending=new Map();
const errors=[];
const results=[];
const requests=[];
const blockedRequests=[];
const verifiedDownloads=[];
let interceptorInstalled=false;
let failure=null;
function isLocalRequest(url){try{const value=new URL(url);return ['http:','https:'].includes(value.protocol)&&['127.0.0.1','localhost'].includes(value.hostname);}catch{return false;}}
async function interceptRequest(params){const request={url:params.request.url,method:params.request.method,resourceType:params.resourceType};requests.push(request);if(isLocalRequest(request.url))return command('Fetch.continueRequest',{requestId:params.requestId});blockedRequests.push({...request,syntheticProbe:request.url===probeURL});return command('Fetch.failRequest',{requestId:params.requestId,errorReason:'InternetDisconnected'});}
async function waitUntil(fn,timeout=18000){const end=Date.now()+timeout;let last;while(Date.now()<end){try{last=await fn();if(last)return last;}catch(e){last=e;}await delay(200);}throw new Error(`Timeout: ${String(last)}`);}
function command(method,params={}){return new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>{pending.delete(key);reject(new Error(`CDP sin respuesta: ${method}`));},15000);pending.set(key,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});socket.send(JSON.stringify({id:key,method,params}));});}
async function evaluate(expression){const result=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);return result.result.value;}
async function click(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay(100);}
async function send(text){const before=await evaluate(`document.querySelectorAll('.message.assistant').length`);await evaluate(`document.getElementById('message-input').value=${JSON.stringify(text)};document.getElementById('chat-form').requestSubmit()`);await waitUntil(()=>evaluate(`document.querySelectorAll('.message.assistant').length>${before}`));return evaluate(`Array.from(document.querySelectorAll('.message.assistant .bubble')).at(-1).textContent`);}
async function check(name,fn){try{await fn();results.push({name,passed:true});console.log(`OK ${name}`);}catch(error){results.push({name,passed:false,error:error.message});throw error;}}
try{
  await mkdir(output,{recursive:true});await mkdir(downloadDirectory,{recursive:true});
  await waitUntil(async()=>{const r=await fetch(`http://127.0.0.1:${port}/json/version`);return r.ok;});
  await waitUntil(async()=>{if(server.exitCode!==null)throw new Error(serverLog);if(!serverLog.includes(`127.0.0.1:${serverPort}`))return false;const r=await fetch(origin);return r.ok;});
  const target=await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  socket=new WebSocket(target.webSocketDebuggerUrl);
  socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown'){errors.push(m.params.exceptionDetails.text);}else if(m.method==='Fetch.requestPaused'){interceptRequest(m.params).catch(error=>errors.push(`Interceptor: ${error.message}`));}});
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  await command('Runtime.enable');await command('Page.enable');
  await command('Network.enable');await command('Network.setCacheDisabled',{cacheDisabled:true});await command('Network.setBypassServiceWorker',{bypass:true});
  await command('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});interceptorInstalled=true;
  await command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloadDirectory});
  await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false});
  await command('Page.navigate',{url:origin});
  await waitUntil(()=>evaluate(`document.getElementById('model-status')?.classList.contains('ready')`));
  await check('El modelo carga y habilita el formulario',async()=>assert.equal(await evaluate(`document.getElementById('message-input').disabled`),false));
  await delay(750);
  const desktop=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(resolve(output,'web-desktop.png'),Buffer.from(desktop.data,'base64'));
  await check('El atajo inicia una consulta de carga de celular',async()=>{await click('[data-prompt="Mi celular no carga"]');await waitUntil(()=>evaluate(`document.getElementById('context-issue').textContent.includes('Carga')`));assert.equal(await evaluate(`document.getElementById('context-device').textContent`),'Celular');});
  await check('Tres turnos conservan equipo y avanzan el diagnóstico',async()=>{await send('No aparece ningún indicador');await send('Sí, el cable está dañado');assert.equal(await evaluate(`document.getElementById('context-device').textContent`),'Celular');assert.equal(await evaluate(`document.getElementById('copy-summary').disabled`),false);});
  await check('Nueva consulta borra contexto y mensajes',async()=>{await click('#new-chat');assert.equal(await evaluate(`document.getElementById('context-device').textContent`),'Por identificar');assert.equal(await evaluate(`document.querySelectorAll('.message.user').length`),0);});
  await check('Una consulta ajena al dominio recibe límites o aclaración',async()=>{const reply=await send('Escríbeme una receta de pastel de chocolate');assert.match(reply,/equipo|soporte|computador|celular|consola|dominio|aclar|reformular/i);});
  await check('El mensaje se muestra como texto y no como HTML',async()=>{await send('<img src=x onerror="window.injected=true">');assert.equal(await evaluate(`window.injected===true`),false);assert.equal(await evaluate(`document.querySelector('.message.user img')!==null`),false);});
  await check('Servicios inicia una consulta desde su tarjeta',async()=>{await click('#new-chat');await click('[data-view="services"]');await click('[data-prompt="El control de mi consola no responde"]');await waitUntil(()=>evaluate(`document.getElementById('context-device').textContent==='Consola'`));assert.equal(await evaluate(`document.getElementById('view-assistant').hidden`),false);});
  await check('El proyecto muestra resultados y descargas válidas',async()=>{
    await click('[data-view="project"]');await waitUntil(()=>evaluate(`document.querySelectorAll('.metric').length===4`));
    const downloads=await evaluate(`(async()=>{const rows=[];for(const path of ['/metrics.json','/downloads/reporte-tecnico.pdf','/downloads/experimentacion.ipynb']){const r=await fetch(path,{cache:'no-store'});const bytes=new Uint8Array(await r.arrayBuffer());const row={path,status:r.status,bytes:bytes.length,signature:Array.from(bytes.slice(0,5)),contentType:r.headers.get('content-type')};if(path.endsWith('.json')||path.endsWith('.ipynb')){const json=JSON.parse(new TextDecoder().decode(bytes));row.validJSON=true;if(path.endsWith('.ipynb')){row.notebookVersion=json.nbformat;row.cellCount=json.cells?.length;}else{row.selectedModel=json.selected_model;}}rows.push(row);}return rows;})()`);
    for(const row of downloads){assert.equal(row.status,200,row.path);assert.ok(row.bytes>100,row.path);if(row.path.endsWith('.pdf'))assert.deepEqual(row.signature,[37,80,68,70,45]);if(row.path.endsWith('.ipynb')){assert.equal(row.notebookVersion,4);assert.ok(row.cellCount>0);}if(row.path.endsWith('/metrics.json'))assert.ok(row.selectedModel);}
    verifiedDownloads.push(...downloads);
  });
  await check('El notebook se descarga desde el navegador sin internet',async()=>{await click('a[href="./downloads/experimentacion.ipynb"]');const file=resolve(downloadDirectory,'experimentacion.ipynb');await waitUntil(async()=>{try{return (await stat(file)).size>100;}catch{return false;}});assert.equal(JSON.parse(await readFile(file,'utf8')).nbformat,4);});
  await check('El bloqueo externo impide una solicitud de prueba',async()=>{const probe=await evaluate(`fetch(${JSON.stringify(probeURL)}).then(()=>({blocked:false})).catch(()=>({blocked:true}))`);assert.equal(interceptorInstalled,true);assert.equal(probe.blocked,true);assert.ok(blockedRequests.some(request=>request.syntheticProbe));});
  await click('[data-view="assistant"]');await click('#new-chat');
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(350);
  await evaluate(`document.getElementById('toast').hidden=true;document.getElementById('message-input').blur()`);
  await check('La vista móvil no desborda horizontalmente',async()=>assert.equal(await evaluate(`document.documentElement.scrollWidth<=window.innerWidth`),true));
  const mobile=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(resolve(output,'web-mobile.png'),Buffer.from(mobile.data,'base64'));
  await check('No hay excepciones JavaScript en el navegador',async()=>assert.deepEqual(errors,[]));
  await check('La aplicación local no solicita recursos externos',async()=>{assert.ok(requests.some(request=>request.url===`${origin}/model.json`));assert.ok(requests.some(request=>request.url===`${origin}/metrics.json`));assert.deepEqual(blockedRequests.filter(request=>!request.syntheticProbe),[]);});
  console.log(`${results.length} comprobaciones del navegador aprobadas con acceso externo bloqueado.`);
}catch(error){failure=error;throw error;}
finally{
  await mkdir(output,{recursive:true});
  await writeFile(resolve(output,'browser-results.json'),JSON.stringify({browser:'Chrome headless/CDP',projectRoot:root,runtimeExecutable:process.execPath,sourceDirectory:'web',distPresent,freshExtractionWithoutDist:process.env.YINYAN_QA_REQUIRE_NO_DIST==='1'&&!distPresent,origin,results,passed:results.filter(row=>row.passed).length,failed:results.filter(row=>!row.passed).length,errors,failure:failure?.message||null,verifiedDownloads,offline:{scope:'Solicitudes de la pestaña interceptadas antes de la primera navegación; no modifica la red del sistema operativo.',enforced:interceptorInstalled,allowedHosts:['127.0.0.1','localhost'],blockedRequests,syntheticProbeURL:probeURL,syntheticBlockedCount:blockedRequests.filter(request=>request.syntheticProbe).length,unintendedExternalRequests:blockedRequests.filter(request=>!request.syntheticProbe).length,localRequestCount:requests.filter(request=>isLocalRequest(request.url)).length},desktop:{width:1440,height:1080},mobile:{width:390,height:844}},null,2));
  socket?.close();chrome.kill();server.kill();
}
