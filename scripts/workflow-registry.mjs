/** Native registry reads keep chat and examples available without Python. */
import {readFile,readdir} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {apiError,csvRows} from './team-store.mjs';
import {trainingCatalog,referenceSource} from './training-catalog.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createWorkflowRegistry(project,runtime){
  const folder=resolve(process.env.YINYAN_TRAINING_DIR||(process.env.YINYAN_DATA_DIR||resolve(runtime)!==resolve(project,'data/local')?resolve(runtime,'training'):resolve(project,'data/training')));
  const python=process.env.YINYAN_PYTHON||(existsSync(resolve(project,'runtime/python/python.exe'))?resolve(project,'runtime/python/python.exe'):'python');
  async function config(){const catalog=await trainingCatalog(project);return{labels:catalog.labels,references:catalog.references,reference_curve:catalog.reference_curve||[]};}
  async function baseline(){const source=await referenceSource(project);return{model_url:`./api/versions/${source.base_id}/model.json`,model:source.version.selected_model,examples:source.examples.length,version:await version(source.base_id),note:'Referencia inicial hasta activar una jornada.'};}
  async function read(path,fallback){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT'&&fallback!==undefined)return fallback;throw error;}}
  function runFolder(id){
    if(typeof id!=='string'||!uuid.test(id))throw apiError('Identificador de versión no válido.');
    const local=resolve(folder,'runs',id.toLowerCase());
    if(existsSync(resolve(local,'run.json')))return local;
    const reference=resolve(project,'data/training/runs',id.toLowerCase());
    if(reference!==local&&existsSync(resolve(reference,'run.json'))){
      const metadata=JSON.parse(readFileSync(resolve(reference,'run.json'),'utf8'));
      if(metadata.run_type==='imported_reference')return reference;
    }
    return local;
  }
  async function activeId(){return(await read(resolve(folder,'active.json'),{})).active_id||null;}
  async function version(id,full=true){
    let row;try{row=await read(resolve(runFolder(id),'run.json'));}catch(error){if(error.code==='ENOENT')throw apiError('No se encontró esa jornada.',404);throw error;}
    let approvals=[];try{approvals=(await readdir(resolve(runFolder(id),'approvals'))).filter(name=>name.endsWith('.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
    const approved=approvals.length>0;
    const reference=row.run_type==='imported_reference';
    row={...row,approval_status:approved?'approved':reference?'reference':'provisional',kind:await activeId()===id?'active':reference||approved?'historical':'provisional',model_url:`./api/versions/${id}/model.json`};
    if(full){
      const names=(await readdir(runFolder(id))).filter(name=>/^final-evaluation-[0-9a-f]{64}\.json$/.test(name));
      const results=await Promise.all(names.map(name=>read(resolve(runFolder(id),name))));
      if(results.length)row.final_evaluation=results.sort((a,b)=>(b.evaluated_at||'').localeCompare(a.evaluated_at||''))[0];
    }
    if(!full)for(const key of ['predictions','errors','artifact_hashes'])delete row[key];return row;
  }
  async function versions(recover=true){
    let entries=[];try{entries=await readdir(resolve(folder,'runs'),{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')throw error;}
    const rows=[];for(const entry of entries)if(entry.isDirectory()&&uuid.test(entry.name)){
      const row=await version(entry.name,false);
      if(row.run_type!=='imported_reference')rows.push(row);
    }
    if(recover&&rows.some(row=>{
      if(row.status!=='running')return false;
      if(!row.process_id)return Date.now()-Date.parse(row.created_at)>30000;
      try{process.kill(row.process_id,0);return false;}catch(error){return error.code==='ESRCH';}
    })){
      try{await call('list');}catch{/* Readable history remains available if Python is unavailable. */}
      return versions(false);
    }
    return{versions:rows.sort((a,b)=>(b.journey||0)-(a.journey||0)||(b.reference_stage||0)-(a.reference_stage||0)),active_id:await activeId(),baseline:await baseline()};
  }
  async function evidence(){
    const tests=await read(resolve(project,'reports/test-results.json'),{});
    let current=Boolean(tests.complete&&tests.source_hashes&&Object.keys(tests.source_hashes).length);
    if(current)for(const[name,hash]of Object.entries(tests.source_hashes)){
      try{if(createHash('sha256').update(await readFile(resolve(project,name))).digest('hex')!==hash){current=false;break;}}
      catch{current=false;break;}
    }
    const id=await activeId(),dialogue=await read(resolve(project,'reports/current-dialogue-results.json'),{}),delivery=await read(resolve(project,'reports/current-delivery-verification.json'),{});
    let documents=current&&delivery.passed===true&&(delivery.version_id||null)===id&&Boolean(delivery.artifact_hashes);
    if(documents)for(const[name,hash]of Object.entries(delivery.artifact_hashes)){
      try{if(createHash('sha256').update(await readFile(resolve(project,name))).digest('hex')!==hash){documents=false;break;}}
      catch{documents=false;break;}
    }
    return{context:current&&dialogue.failed===0&&dialogue.passed>=7&&(dialogue.version_id||null)===id,documents};
  }
  async function active(){const id=await activeId();if(id)return{active_id:id,model_url:`./api/versions/${id}/model.json`,version:await version(id)};const initial=await baseline();return{active_id:null,model_url:initial.model_url,version:initial.version,baseline:initial};}
  function child(command,args=[],stdio=['ignore','pipe','pipe']){return spawn(python,['-m','src.training_runs',command,'--runtime',runtime,...args],{cwd:project,env:{...process.env,PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1',YINYAN_NODE:process.execPath},windowsHide:true,stdio});}
  function call(command,args=[]){return new Promise((done,reject)=>{const process=child(command,args);let output='',errors='';process.stdout.on('data',chunk=>{output=(output+chunk.toString('utf8')).slice(-3*1024*1024);});process.stderr.on('data',chunk=>{errors=(errors+chunk.toString('utf8')).slice(-2000);});process.once('error',error=>reject(apiError(`No se pudo abrir Python: ${error.message}`,503)));process.once('close',code=>{let value;try{value=JSON.parse(output.trim().split('\n').at(-1));}catch{reject(apiError(errors||'La operación no produjo un resultado válido.',500));return;}if(code!==0)reject(apiError(value.error||errors||'La operación falló.',value.status||500));else done(value);});});}
  async function progress(snapshot){
    const source=await referenceSource(project);const base=source.examples,rows=snapshot.examples;
    const count=(intent,status)=>rows.filter(row=>(!intent||row.intent===intent)&&(row.review_status||'pending')===status).length;
    const per_intent=Object.keys(source.labels).map(intent=>{const n=base.filter(row=>row.intent===intent).length;const approved=n+count(intent,'approved');return{intent,base:n,approved,pending:count(intent,'pending'),rejected:count(intent,'rejected'),missing:Math.max(0,20-approved)};});
    const missing=per_intent.reduce((n,row)=>n+row.missing,0);let final_size=0,finalVerified=false;try{
      const content=await readFile(process.env.YINYAN_FINAL_TEST_FILE||resolve(project,'data/final-test.csv'),'utf8');
      const rows=csvRows(content.replace(/^\uFEFF/,'')),header=rows.shift()||[],index=header.indexOf('text'),intentIndex=header.indexOf('intent');
      const records=index<0?[]:rows.filter(row=>row[index]?.trim());final_size=records.length;
      if(final_size>=50&&intentIndex>=0){
        const model=source.model,stop=new Set(model.preprocessing.stopwords),lemmas=model.preprocessing.lemma_map;
        const normalized=text=>(text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z0-9]+/g)||[]).filter(word=>!stop.has(word)).map(word=>lemmas[word]||word).join(' ');
        const pairs=records.map(row=>[normalized(row[index]),row[intentIndex]]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:a[1]>b[1]?1:0);
        const hash=createHash('sha256').update(JSON.stringify(pairs)).digest('hex'),receipt=await read(resolve(folder,'final-receipts',`${hash}.json`),{});
        finalVerified=receipt.status==='completed'&&receipt.run_id===await activeId();
      }
    }catch(error){if(error.code!=='ENOENT')throw error;}
    const verified=await evidence();
    const history=await versions();return{counts:{base:base.length,total:base.length+rows.length,approved:base.length+count(null,'approved'),approved_additional:count(null,'approved'),pending:count(null,'pending'),rejected:count(null,'rejected')},per_intent,intents:source.labels,missing_examples_total:missing,dataset_version:snapshot.approved_revision||snapshot.revision,active:await active(),last_training:history.versions.find(row=>row.run_type!=='imported_reference')||null,final_test_size:final_size,rubric:[
      {id:'dataset',title:'20 ejemplos por intención',status:missing?'Pendiente de datos':'Cumplido',evidence:`Faltan ${missing} ejemplos aprobados.`},
      {id:'pln',title:'PLN e inferencia consistente',status:'Cumplido',evidence:'Tokenizador compartido, TF-IDF y comprobación de exportación en cada jornada.'},
      {id:'models',title:'Dos clasificadores y selección',status:history.versions.some(row=>row.status==='succeeded'&&Object.keys(row.models||{}).length>=2&&row.cv?.naive_bayes&&row.cv?.logistic_regression)?'Cumplido':'Pendiente de verificación',evidence:'CV estratificada de cinco pliegues; selección por F1 macro. Las referencias con un solo algoritmo no acreditan esta comparación.'},
      {id:'final',title:'Prueba final independiente',status:final_size<50?'Pendiente de datos':finalVerified?'Cumplido':'Pendiente de verificación',evidence:`${final_size}/50 consultas; evaluación explícita por versión y recibo de apertura.`},
      {id:'context',title:'Contexto, variantes y reinicio',status:verified.context?'Cumplido':'Pendiente de verificación',evidence:'Pruebas funcionales de la versión y hashes de código en reports/.'},
      {id:'documents',title:'Notebook y PDF de la versión',status:verified.documents?'Cumplido':'Pendiente de verificación',evidence:'Notebook ejecutado, PDF verificado y hashes de la versión activa.'}]};
  }
  return{read,runFolder,versions,version,active,activeId,progress,call,child,python,baseline,config};
}
