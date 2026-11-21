import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const python=process.env.YINYAN_PYTHON||resolve(root,'runtime/python/python.exe');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function runServer(command,args,port){
  const child=spawn(command,args,{cwd:root,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'pipe'});
  let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
  const origin=`http://127.0.0.1:${port}`;
  try{
    let ready=false;
    for(let i=0;i<60;i++){try{const r=await fetch(`${origin}/health`);ready=(await r.json()).app==='yinyan-workshop';if(ready)break;}catch{}await delay(100);}
    assert.equal(ready,true,output);
    const health=await (await fetch(`${origin}/health`)).json();assert.equal(health.mode,'local');assert.equal(health.offline,true);
    const home=await fetch(`${origin}/`);assert.equal(home.status,200);assert.match(await home.text(),/YinYan Workshop/);
    const active=await(await fetch(`${origin}/api/models/active`)).json();
    assert.equal(typeof active.model_url,'string');
    const modelUrl=new URL(active.model_url,origin+'/');
    assert.equal(modelUrl.origin,origin);
    const model=await (await fetch(modelUrl)).json();assert.equal(model.classes.length,16);
    const metadata=await(await fetch(`${origin}/api/versions/${active.active_id||active.version?.id||active.baseline?.id}`)).json();
    assert.ok(metadata.counts.total>=200);assert.equal(metadata.counts.total,model.trained_examples);
    assert.equal(metadata.selected_model,model.model_type);
    const pdf=await fetch(`${origin}/downloads/reporte-tecnico.pdf`);assert.equal(pdf.status,200);assert.ok(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).equals(Buffer.from('%PDF-')));
    const notebook=await (await fetch(`${origin}/downloads/experimentacion.ipynb`)).json();assert.equal(notebook.nbformat,4);
    assert.equal((await fetch(modelUrl,{method:'HEAD'})).status,200);
    assert.equal((await fetch(`${origin}/no-existe.json`)).status,404);
    assert.ok([403,404].includes((await fetch(`${origin}/..%2f.git/config`)).status));
    const duplicate=spawn(command,args,{cwd:root,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'pipe'});
    let duplicateOutput='';duplicate.stdout.on('data',d=>duplicateOutput+=d);duplicate.stderr.on('data',d=>duplicateOutput+=d);
    let duplicateTimer;
    const code=await Promise.race([new Promise((r,j)=>{duplicate.once('error',j);duplicate.once('close',r);}),new Promise((_,reject)=>{duplicateTimer=setTimeout(()=>{duplicate.kill();reject(new Error('El segundo inicio no terminó.'));},6000);})]).finally(()=>clearTimeout(duplicateTimer));
    assert.equal(code,0,duplicateOutput);assert.match(duplicateOutput,/ya est/);
    assert.equal((await fetch(`${origin}/health`)).status,200);
  }finally{child.kill();}
}
test('Servidor Node: modelo, métricas, PDF y notebook locales sin dist ni instalación',()=>runServer(process.execPath,[resolve(root,'scripts/serve.mjs')],4186));
test('Servidor Python estándar: mismas funciones y segundo inicio sin conflicto',{skip:!existsSync(python)},()=>runServer(python,[resolve(root,'scripts/serve.py')],4187));
