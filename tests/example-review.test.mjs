import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile, mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTeamStore, csvRows} from '../scripts/team-store.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const python=resolve(root,'runtime/python/python.exe');
const execute=promisify(execFile);
const first={text:'Al abrir mis programas de dibujo la laptop queda inmovil durante varios minutos',intent:'rendimiento',author:'alumno-a'};
const second={text:'El telefono solo acumula un punto de bateria durante toda la tarde conectado',intent:'carga',author:'alumno-b'};
function store(runtime) {
  const previous=process.env.YINYAN_DATA_DIR;
  process.env.YINYAN_DATA_DIR=runtime;
  try{return createTeamStore({project:root,runtime});}
  finally{if(previous===undefined)delete process.env.YINYAN_DATA_DIR;else process.env.YINYAN_DATA_DIR=previous;}
}
async function inWorkspace(work) {
  const folder=await mkdtemp(join(tmpdir(),'yinyan-example-review-'));
  try{await work(folder,store(folder));}
  finally{assert.equal(dirname(folder),resolve(tmpdir()));await rm(folder,{recursive:true,force:true});}
}
async function pythonCall(folder,action,payload={}) {
  const script=`import json,sys\nfrom pathlib import Path\nfrom scripts.team_store import TeamStore,ApiError\ns=TeamStore(Path.cwd(),Path(sys.argv[1]))\na=sys.argv[2]\np=json.loads(sys.argv[3])\nif a=='snapshot': r=s.snapshot()\nelif a=='create': r=s.create_example(p)\nelif a=='review': r=s.review_example(p.pop('id'),p)\nelif a=='edit': r=s.edit_example(p.pop('id'),p)\nelif a=='delete':\n try: r=s.delete_example(p.pop('id'),p)\n except ApiError as error: r={'status':error.status,'error':str(error)}\nelse: raise ValueError(a)\nprint(json.dumps(r,ensure_ascii=True))`;
  const {stdout}=await execute(python,['-c',script,folder,action,JSON.stringify(payload)],{
    cwd:root,windowsHide:true,env:{...process.env,YINYAN_DATA_DIR:folder,PYTHONUTF8:'1'},maxBuffer:1024*1024});
  return JSON.parse(stdout);
}
const conflict=error=>error.status===409;

test('CSV: un salto de línea entre comillas no se cuenta como otra consulta',()=>{
  const rows=csvRows('text,intent\r\n"Mi pantalla\nparpadea, a veces",pantalla\r\n"Dice ""error"" al abrir",software\r\n');
  assert.equal(rows.length,3);
  assert.deepEqual(rows[0],['text','intent']);
  assert.equal(rows[1][0],'Mi pantalla\nparpadea, a veces');
  assert.equal(rows[2][0],'Dice "error" al abrir');
});

test('Revisión: guardar, editar y aprobar conserva originales y excluye pendientes del entrenamiento',async()=>inWorkspace(async(folder,s)=>{
  const before=Date.now();
  const initial=await s.snapshot();
  const created=await s.createExample({...first,review_status:'approved',created_at:'2000-01-01T00:00:00.000Z'});
  const row=created.examples[0];
  assert.equal(row.review_status,'pending');
  assert.ok(Date.parse(row.created_at)>=before);
  assert.deepEqual(created.counts,{pending:1,approved:0,rejected:0});
  assert.equal(created.approved_examples.length,0);
  assert.equal(created.approved_revision,initial.approved_revision,'Un pendiente no cambia el corpus aprobado.');
  const originalPath=join(folder,'team-records','alumno-a','examples',row.id+'.json');
  const original=await readFile(originalPath,'utf8');
  await assert.rejects(s.editExample(row.id,{...first,text:'Otra descripcion con datos nuevos',author:'raynier',record_version:'obsoleta'}),conflict);
  const edited=await s.editExample(row.id,{...first,text:first.text+' y necesita reiniciarse',author:'raynier',record_version:row.record_version});
  assert.equal(edited.examples[0].created_at,row.created_at);
  assert.equal(edited.examples[0].author,'alumno-a');
  assert.equal(edited.examples[0].updated_by,'raynier');
  await assert.rejects(s.deleteExample(row.id,{author:'sergio',record_version:row.record_version}),conflict,
    'Una pestaña obsoleta no puede retirar la edición nueva de otro responsable.');
  const pythonDelete=await pythonCall(folder,'delete',{id:row.id,author:'sergio',record_version:row.record_version});
  assert.equal(pythonDelete.status,409,'Python protege la misma edición frente a una retirada obsoleta.');
  assert.deepEqual(await s.snapshot(),edited,'Rechazar una retirada obsoleta no altera el dataset.');
  assert.equal(await readFile(originalPath,'utf8'),original,'Editar nunca reescribe el registro original.');
  const approved=await s.reviewExample(row.id,{review_status:'approved',author:'sergio',record_version:edited.examples[0].record_version});
  assert.equal(approved.approved_examples.length,1);
  assert.equal(approved.examples[0].reviewed_by,'sergio');
  assert.equal(approved.examples[0].dataset_version,approved.revision);
  assert.notEqual(approved.approved_revision,initial.approved_revision);
  await assert.rejects(s.deleteExample(row.id,{author:'sergio'}),conflict);
  await assert.rejects(s.editExample(row.id,{...first,author:'raynier'}),conflict);
  const reopened=await s.reviewExample(row.id,{review_status:'pending',author:'sergio'});
  assert.equal(reopened.approved_examples.length,0);
  const deleted=await s.deleteExample(row.id,{author:'alumno-b'});
  assert.equal(deleted.examples.length,0);
  assert.equal(await readFile(originalPath,'utf8'),original);
  assert.equal((await readdir(join(folder,'team-records','alumno-b','deletions'))).length,1);
}));

test('Revisión: detección lexical, protección de prueba y revisión idempotente de consulta',async()=>inWorkspace(async(folder,s)=>{
  await s.createExample(first);
  await assert.rejects(s.createExample({...first,text:'¡¡'+first.text.toUpperCase()+'!!',author:'alumno-b'}),conflict);
  const history=JSON.parse(await readFile(resolve(root,'data/training/training_history.json'),'utf8'));
  const baseFolder=resolve(root,'data/training/runs',history.references.base_id);
  const base=JSON.parse(await readFile(resolve(baseFolder,'snapshot.json'),'utf8'));
  const protectedExample=base.training_examples[0];
  await assert.rejects(s.createExample({text:protectedExample.text,intent:protectedExample.intent,author:'alumno-a'}),conflict);
  const reference=JSON.parse(await readFile(resolve(baseFolder,'benchmark.json'),'utf8'));
  const heldOut=reference[0];
  await assert.rejects(s.createExample({text:heldOut.text,intent:heldOut.intent,author:'alumno-a'}),conflict);
  const query={id:randomUUID(),session_id:'sesion-con-version',author:'sergio',text:second.text,
    response:'Describe las condiciones del cable.',intent:'carga',accepted:true,model:{kind:'version',version_id:history.references.base_id},resolution:null};
  const saved=await s.createQuery(query);
  assert.equal(saved.value.query.model.version_id,query.model.version_id);
  const review=await s.reviewQuery(query.id,{author:'alumno-b',intent:'carga'});
  const converted=review.value.examples.find(row=>row.source_query_id===query.id);
  assert.equal(converted.review_status,'pending');
  await s.reviewExample(converted.id,{review_status:'rejected',author:'raynier',note:'Revisar la expresion antes de entrenar'});
  const again=await s.reviewQuery(query.id,{author:'alumno-a',intent:'carga'});
  assert.equal(again.status,200);
  assert.equal(again.value.examples.length,2,'Un ejemplo rechazado no se vuelve a crear desde la consulta.');
  assert.equal((await s.queries()).queries[0].created_at,saved.value.query.created_at);
}));

test('Revisión: Python y Node leen la misma bitácora, estados y versiones después de reiniciar',async()=>inWorkspace(async(folder,s)=>{
  const nodeCreated=await s.createExample(first);
  assert.deepEqual(await pythonCall(folder,'snapshot'),nodeCreated);
  const pythonCreated=await pythonCall(folder,'create',second);
  assert.deepEqual(await store(folder).snapshot(),pythonCreated);
  const firstRow=pythonCreated.examples.find(row=>row.author==='alumno-a');
  const pythonReviewed=await pythonCall(folder,'review',{id:firstRow.id,review_status:'approved',author:'raynier'});
  assert.deepEqual(await s.snapshot(),pythonReviewed);
  const secondRow=pythonReviewed.examples.find(row=>row.author==='alumno-b');
  const nodeEdited=await s.editExample(secondRow.id,{...second,text:second.text+' y el indicador no cambia',author:'sergio'});
  assert.deepEqual(await pythonCall(folder,'snapshot'),nodeEdited);
  assert.equal(nodeEdited.counts.approved,1);
  assert.equal(nodeEdited.counts.pending,1);
}));

test('Revisión: las aprobaciones concurrentes obsoletas dejan el ejemplo pendiente',async()=>inWorkspace(async(folder,s)=>{
  const pending=(await s.createExample(first)).examples[0];
  for(const author of ['sergio','raynier']) {
    const event={id:randomUUID(),example_id:pending.id,author,action:'review',review_status:'approved',note:'',
      parent_version:pending.record_version,sequence:1,created_at:new Date().toISOString(),timezone:'America/Mexico_City',timestamp_kind:'recorded'};
    const directory=join(folder,'team-records',author,'events');
    await mkdir(directory,{recursive:true});
    await writeFile(join(directory,event.id+'.json'),JSON.stringify(event));
  }
  const branched=await s.snapshot();
  assert.equal(branched.examples[0].review_status,'pending');
  assert.equal(branched.examples[0].review_conflict,true);
  assert.equal(branched.approved_examples.length,0);
  assert.deepEqual(await pythonCall(folder,'snapshot'),branched);
  const resolved=await s.reviewExample(pending.id,{review_status:'approved',author:'sergio',record_version:branched.examples[0].record_version});
  assert.equal(resolved.examples[0].review_status,'approved');
  assert.equal(resolved.examples[0].review_conflict,false);
}));

test('Revisión: migración conserva fechas desconocidas y requiere aprobación explícita',async()=>inWorkspace(async(folder,s)=>{
  const old={examples:[{id:'legado-sin-fecha',...first}]};
  await writeFile(join(folder,'student-examples.json'),JSON.stringify(old));
  const migrated=await s.snapshot();
  assert.equal(migrated.examples[0].created_at,null);
  assert.equal(migrated.examples[0].timestamp_kind,'unknown');
  assert.equal(migrated.examples[0].review_status,'pending');
  assert.equal(migrated.approved_examples.length,0);
  assert.deepEqual(await pythonCall(folder,'snapshot'),migrated);
  assert.deepEqual(JSON.parse(await readFile(join(folder,'student-examples.json'),'utf8')),old);
}));
