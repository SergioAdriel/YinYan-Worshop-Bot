/** Registros inmutables por aportación para compartir el proyecto mediante Git. */
import {readFile,writeFile,mkdir,readdir,link,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {referenceSource,storedQueryModel} from './training-catalog.mjs';

export const TIMEZONE = 'America/Mexico_City';
export const AUTHORS = ['alumno-a','alumno-b','sergio','raynier'];
const REVIEW_STATES = new Set(['pending','approved','rejected']);
const MAX_EXAMPLES = 2000;
const INTENTS = new Set('saludo despedida ayuda encendido carga temperatura rendimiento conexion pantalla sonido almacenamiento software controles liquidos presupuesto contacto'.split(' '));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;
export const apiError = (message,status=400) => Object.assign(new Error(message),{status});
const hash = value => createHash('sha256').update(value).digest('hex');
const key = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
function uuidId(value) {
  if(typeof value !== 'string' || !UUID.test(value)) throw apiError('El identificador debe ser un UUID válido.');
  return value.toLowerCase();
}
function textValue(value,min=3,max=1200) {
  if(typeof value !== 'string' || value.trim().length < min || value.trim().length > max || CONTROL.test(value)) throw apiError(`Escribe un texto de entre ${min} y ${max} caracteres.`);
  return value.trim();
}
function authorValue(value) {
  if(!AUTHORS.includes(value)) throw apiError('Elige uno de los cuatro responsables del equipo.');
  return value;
}
function intentValue(value) {
  if(!INTENTS.has(value)) throw apiError('Elige una categoría válida.');
  return value;
}
function cleanExample(row) {
  if(!row || typeof row !== 'object' || Array.isArray(row)) throw apiError('Cada ejemplo debe ser un objeto.');
  return {text:textValue(row.text),intent:intentValue(row.intent),author:authorValue(row.author)};
}

// Lector CSV sin dependencias: conserva comas, comillas y saltos en campos.
export function csvRows(content) {
  const rows=[]; let row=[],field='',quoted=false;
  for(let index=0;index<content.length;index++) {
    const character=content[index];
    if(character==='"') {if(quoted&&content[index+1]==='"'){field+='"';index++;}else quoted=!quoted;}
    else if(character===','&&!quoted){row.push(field);field='';}
    else if(character==='\n'&&!quoted){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}
    else field+=character;
  }
  if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
  if(quoted) throw apiError('El archivo de evaluación CSV tiene comillas sin cerrar.',500);
  return rows;
}

export function createTeamStore({project,runtime}) {
  const folder = resolve(process.env.YINYAN_TEAM_DIR || (process.env.YINYAN_DATA_DIR ? resolve(runtime,'team-records') : resolve(project,'data/team')));
  const legacy = resolve(runtime,'student-examples.json');
  const marker = resolve(runtime,'migration-complete.json');
  let migrating;
  let tokenizerPromise;
  async function tokenizer() {
    if(!tokenizerPromise) tokenizerPromise=(async()=>{
      const {model}=await referenceSource(project);
      const stopwords=new Set(model.preprocessing.stopwords),lemmas=model.preprocessing.lemma_map;
      return text=>(String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z0-9]+/g)||[])
        .filter(word=>!stopwords.has(word)).map(word=>lemmas[word]||word).join(' ');
    })().catch(error=>{tokenizerPromise=null;throw error;});
    return tokenizerPromise;
  }
  async function protectedTexts() {
    const normalized=await tokenizer();
    const source=await referenceSource(project);
    const base=new Set(source.examples.map(row=>normalized(row.text)));
    const evaluation=new Set();
    const paths=[resolve(project,'data/test.csv'),resolve(process.env.YINYAN_FINAL_TEST_FILE||resolve(project,'data/final-test.csv'))];
    for(const path of new Set(paths)) {
      let content;
      try{content=await readFile(path,'utf8');}catch(error){if(error.code==='ENOENT')continue;throw error;}
      const rows=csvRows(content.replace(/^\uFEFF/,'')),index=(rows.shift()||[]).indexOf('text');
      if(index>=0) for(const row of rows) if(row[index]?.trim()) evaluation.add(normalized(row[index]));
    }
    return {normalized,base,evaluation};
  }

  // Cada archivo es un registro independiente que se puede compartir por Git.
  async function append(path,value) {
    const directory = resolve(path,'..');
    await mkdir(directory,{recursive:true});
    const temporary = resolve(directory,`.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{encoding:'utf8',flag:'wx'});
      // Un enlace publica el archivo completo y falla si otro proceso ya lo creó.
      await link(temporary,path);
    } finally {
      try {await unlink(temporary);} catch(error) {if(error.code !== 'ENOENT') throw error;}
    }
  }
  const pathFor = (author,kind,id) => resolve(folder,authorValue(author),kind,`${uuidId(id)}.json`);
  async function records(kind) {
    const rows = [];
    for(const author of AUTHORS) {
      const directory = resolve(folder,author,kind);
      let files;
      try {files = await readdir(directory);} catch(error) {if(error.code === 'ENOENT') continue; throw error;}
      for(const name of files.filter(name=>name.endsWith('.json')).sort()) {
        let row;
        try {
          row = JSON.parse(await readFile(resolve(directory,name),'utf8'));
          if(!row || row.author !== author || `${uuidId(row.id)}.json` !== name) throw new Error('Registro inválido');
        } catch {throw apiError(`Hay un registro dañado en data/team: ${name}. Conserva una copia y revísalo.`,500);}
        rows.push(row);
      }
    }
    return rows.sort((a,b)=>(a.created_at || '').localeCompare(b.created_at || '') || a.id.localeCompare(b.id));
  }
  async function migrate() {
    if(!migrating) migrating = (async()=>{
      try {await readFile(marker);return;} catch(error) {if(error.code !== 'ENOENT') throw error;}
      let payload;
      try {
        payload = JSON.parse(await readFile(legacy,'utf8'));
        if(!Array.isArray(payload?.examples)) throw new Error('Formato inválido');
      } catch(error) {
        if(error.code === 'ENOENT') payload = {examples:[]};
        else throw apiError('El archivo legado student-examples.json está dañado. Conserva una copia y revísalo.',500);
      }
      for(const old of payload.examples) {
        const clean = cleanExample(old);
        let id;
        try {id = uuidId(old.id);} catch {
          const seed = old.id === undefined || old.id === null ? hash(JSON.stringify(clean)) : String(old.id);
          const hex = hash(`yinyan-legacy:${seed}`).slice(0,32);
          id = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
        }
        const row = {id,...clean,created_at:null,timezone:TIMEZONE,timestamp_kind:'unknown',source:'manual'};
        try {await append(pathFor(row.author,'examples',id),row);} catch(error) {if(error.code !== 'EEXIST') throw error;}
      }
      try {await append(marker,{completed_at:new Date().toISOString(),legacy_examples:payload.examples.length});} catch(error) {if(error.code !== 'EEXIST') throw error;}
    })().catch(error=>{migrating=null;throw error;});
    return migrating;
  }
  const projection=row=>({id:row.id,text:row.text,intent:row.intent,author:row.author,
    review_status:row.review_status,record_version:row.record_version,review_conflict:row.review_conflict});
  const revisionFor=rows=>hash(JSON.stringify([...rows].sort((a,b)=>a.id.localeCompare(b.id)).map(projection)));
  // El estado visible se reconstruye aplicando los eventos al ejemplo original.
  function materialize(original,events) {
    const clean=cleanExample(original);
    const row={id:original.id,...clean,created_at:original.created_at??null,timezone:TIMEZONE,
      timestamp_kind:original.timestamp_kind||'unknown',source:original.source||'manual'};
    if(original.source_query_id)row.source_query_id=original.source_query_id;
    row.review_status=REVIEW_STATES.has(original.review_status)?original.review_status:'pending';
    row.reviewed_at=null;row.reviewed_by=null;row.updated_at=row.created_at;row.updated_by=row.author;
    row.review_conflict=false;row.event_sequence=0;
    const versions=[row.id];row.record_version=hash(JSON.stringify(versions));
    for(const event of events.filter(item=>item.example_id===row.id).sort((a,b)=>(a.sequence||0)-(b.sequence||0)||a.id.localeCompare(b.id))) {
      const matches=event.parent_version===row.record_version;
      if(matches&&event.action==='edit') {
        row.text=textValue(event.text);row.intent=intentValue(event.intent);row.review_status='pending';
        row.reviewed_at=null;row.reviewed_by=null;row.review_conflict=false;
      } else if(matches&&event.action==='review'&&REVIEW_STATES.has(event.review_status)) {
        row.review_status=event.review_status;row.reviewed_at=event.created_at;row.reviewed_by=event.author;
        row.review_note=event.note||'';row.review_conflict=false;
      } else {row.review_status='pending';row.review_conflict=true;}
      row.updated_at=event.created_at;row.updated_by=event.author;
      row.event_sequence=Math.max(row.event_sequence,event.sequence||0);
      versions.push(event.id);row.record_version=hash(JSON.stringify(versions));
    }
    return row;
  }
  // La revisión aprobada identifica los ejemplos que deben entrar al entrenamiento.
  async function snapshot() {
    await migrate();
    const [deletions,originals,events,normalized]=await Promise.all([records('deletions'),records('examples'),records('events'),tokenizer()]);
    const deleted=new Set(deletions.map(row=>row.example_id));
    const examples=originals.filter(row=>!deleted.has(row.id)).map(row=>materialize(row,events));
    // Dos aportaciones concurrentes con el mismo texto quedan pendientes de resolver.
    const groups=new Map();
    for(const row of examples){const value=normalized(row.text);groups.set(value,[...(groups.get(value)||[]),row]);}
    for(const rows of groups.values()) if(rows.length>1) for(const row of rows){row.review_status='pending';row.review_conflict=true;}
    const revision=revisionFor(examples);
    for(const row of examples)row.dataset_version=revision;
    const approved_examples=examples.filter(row=>row.review_status==='approved');
    return {examples,revision,dataset_version:revision,approved_examples,approved_revision:revisionFor(approved_examples),
      counts:Object.fromEntries([...REVIEW_STATES].map(status=>[status,examples.filter(row=>row.review_status===status).length]))};
  }
  async function ensureUnique(clean,examples,excluding=null) {
    const {normalized,base,evaluation}=await protectedTexts();
    const value=normalized(clean.text);
    if(!value)throw apiError('Escribe una consulta con palabras útiles, no solo signos o palabras vacías.');
    if(evaluation.has(value))throw apiError('Esa expresión pertenece al conjunto de evaluación y no puede incorporarse al entrenamiento.',409);
    if(base.has(value))throw apiError('Esa expresión ya está en la base inicial. Agrega una redacción diferente y pertinente.',409);
    if(examples.some(row=>row.id!==excluding&&normalized(row.text)===value))throw apiError('Esa consulta ya existe tras preparar el texto. Revisa su categoría en la lista.',409);
  }
  async function createExample(data,source='manual',sourceQueryId=null) {
    const clean = cleanExample(data);
    const {examples} = await snapshot();
    await ensureUnique(clean,examples);
    if(examples.length >= MAX_EXAMPLES) throw apiError(`Puedes guardar hasta ${MAX_EXAMPLES} ejemplos propios.`);
    const row = {id:randomUUID(),...clean,created_at:new Date().toISOString(),timezone:TIMEZONE,timestamp_kind:'recorded',source,review_status:'pending'};
    if(sourceQueryId) row.source_query_id = sourceQueryId;
    row.dataset_version=revisionFor([...examples,materialize(row,[])]);
    await append(pathFor(row.author,'examples',row.id),row);
    return snapshot();
  }
  async function importExamples(data) {
    if(!data || !Array.isArray(data.examples) || data.examples.length > MAX_EXAMPLES) throw apiError(`Importa un JSON con examples y un máximo de ${MAX_EXAMPLES} ejemplos.`);
    const rows = data.examples.map(cleanExample);
    const {examples} = await snapshot();
    const normalized=await tokenizer();
    const known = new Map(examples.map(row=>[normalized(row.text),row.intent]));
    const additions = [];
    for(const row of rows) {
      const value = normalized(row.text);
      if(known.has(value)) {
        if(known.get(value) !== row.intent) throw apiError('Una consulta importada tiene dos categorías distintas. Corrígela antes de importar.',409);
        continue;
      }
      await ensureUnique(row,examples);
      known.set(value,row.intent); additions.push(row);
    }
    if(examples.length+additions.length > MAX_EXAMPLES) throw apiError(`Puedes guardar hasta ${MAX_EXAMPLES} ejemplos propios.`);
    for(const row of additions) await createExample(row);
    return snapshot();
  }
  async function deleteExample(id,data={}) {
    id = uuidId(id);
    const example = (await snapshot()).examples.find(row=>row.id === id);
    if(!example) throw apiError('No se encontró ese ejemplo.',404);
    if(example.review_status!=='pending')throw apiError('Reabre el ejemplo como pendiente antes de eliminarlo.',409);
    if(!data || typeof data !== 'object' || Array.isArray(data)) throw apiError('El contenido debe ser un objeto.');
    if(data.record_version!==undefined&&data.record_version!==null&&data.record_version!==example.record_version)throw apiError('El ejemplo cambió en otra sesión. Actualiza la lista antes de eliminarlo.',409);
    const author = authorValue(data.author === undefined ? example.author : data.author);
    const row = {id:randomUUID(),example_id:id,author,created_at:new Date().toISOString(),timezone:TIMEZONE};
    await append(pathFor(author,'deletions',row.id),row);
    return snapshot();
  }
  async function editExample(id,data) {
    id=uuidId(id);
    const saved=await snapshot(),example=saved.examples.find(row=>row.id===id);
    if(!example)throw apiError('No se encontró ese ejemplo.',404);
    if(example.review_status!=='pending')throw apiError('Reabre el ejemplo como pendiente antes de editarlo.',409);
    const clean=cleanExample(data);
    if(data.record_version!==undefined&&data.record_version!==null&&data.record_version!==example.record_version)throw apiError('El ejemplo cambió en otra sesión. Actualiza la lista y revisa sus datos.',409);
    await ensureUnique(clean,saved.examples,id);
    const event={id:randomUUID(),example_id:id,author:clean.author,action:'edit',text:clean.text,intent:clean.intent,
      parent_version:example.record_version,sequence:example.event_sequence+1,created_at:new Date().toISOString(),timezone:TIMEZONE,timestamp_kind:'recorded',dataset_version_before:saved.revision};
    await append(pathFor(event.author,'events',event.id),event);
    return snapshot();
  }
  async function reviewExample(id,data) {
    id=uuidId(id);
    if(!data||typeof data!=='object'||Array.isArray(data))throw apiError('La revisión debe ser un objeto.');
    if(!REVIEW_STATES.has(data.review_status))throw apiError('Elige pendiente, aprobado o rechazado.');
    const saved=await snapshot(),example=saved.examples.find(row=>row.id===id);
    if(!example)throw apiError('No se encontró ese ejemplo.',404);
    const author=authorValue(data.author);
    if(data.record_version!==undefined&&data.record_version!==null&&data.record_version!==example.record_version)throw apiError('El ejemplo cambió en otra sesión. Actualiza la lista y revisa sus datos.',409);
    if(data.review_status==='approved')await ensureUnique(example,saved.examples,id);
    const note=data.note==null?'':textValue(data.note,0,600);
    const event={id:randomUUID(),example_id:id,author,action:'review',review_status:data.review_status,note,
      parent_version:example.record_version,sequence:example.event_sequence+1,created_at:new Date().toISOString(),timezone:TIMEZONE,timestamp_kind:'recorded',dataset_version_before:saved.revision};
    await append(pathFor(author,'events',event.id),event);
    return snapshot();
  }
  async function cleanQuery(data) {
    if(!data || typeof data !== 'object' || Array.isArray(data)) throw apiError('La consulta debe ser un objeto.');
    const session_id = textValue(data.session_id,1,80);
    const author = authorValue(data.author);
    const intent = data.intent ?? null;
    if(intent !== null && !['aclaracion','desconocida','seguridad'].includes(intent)) intentValue(intent);
    if(typeof data.accepted !== 'boolean') throw apiError('La consulta debe indicar si la predicción fue aceptada.');
    let model;
    if(data.model?.kind==='version') model={kind:'version',version_id:uuidId(data.model.version_id)};
    else if(data.model?.kind==='simulation'&&Number.isInteger(data.model.day)&&data.model.day>=1&&data.model.day<=15) model=await storedQueryModel(project,data.model);
    else if(data.model?.kind==='custom') throw apiError('La consulta pendiente pertenece a un modelo anterior que no se puede identificar. La copia se conserva en este navegador.');
    else throw apiError('Indica la versión de entrenamiento utilizada en la consulta.');
    return {session_id,author,text:textValue(data.text,1,1200),response:textValue(data.response,1,6000),intent,accepted:data.accepted,model,resolution:data.resolution == null ? null : textValue(data.resolution,1,80)};
  }
  async function queries() {
    const {examples} = await snapshot();
    const reviewed = new Map(examples.filter(row=>row.source_query_id).map(row=>[row.source_query_id,row.id]));
    const rows = await Promise.all((await records('queries')).map(async row=>({...row,model:await storedQueryModel(project,row.model),reviewed:reviewed.has(row.id),...(reviewed.has(row.id) ? {example_id:reviewed.get(row.id)} : {})})));
    return {queries:rows,timezone:TIMEZONE};
  }
  async function createQuery(data) {
    const clean = await cleanQuery(data);
    const id = data.id === undefined ? randomUUID() : uuidId(data.id);
    const old = (await records('queries')).find(row=>row.id === id);
    if(old) {
      if(JSON.stringify(await cleanQuery({...old,model:await storedQueryModel(project,old.model)})) !== JSON.stringify(clean)) throw apiError('Ese identificador ya pertenece a otra consulta.',409);
      return {status:200,value:{query:(await queries()).queries.find(row=>row.id === id)}};
    }
    const row = {id,...clean,created_at:new Date().toISOString(),timezone:TIMEZONE,timestamp_kind:'recorded'};
    try {await append(pathFor(row.author,'queries',id),row);} catch(error) {
      if(error.code === 'EEXIST') return createQuery(data);
      throw error;
    }
    return {status:201,value:{query:{...row,reviewed:false}}};
  }
  async function reviewQuery(id,data) {
    id = uuidId(id);
    const query = (await records('queries')).find(row=>row.id === id);
    if(!query) throw apiError('No se encontró esa consulta.',404);
    if(!data || typeof data !== 'object' || Array.isArray(data)) throw apiError('La revisión debe ser un objeto.');
    const row = cleanExample({text:data.text ?? query.text,intent:data.intent,author:data.author});
    const saved = await snapshot();
    if(saved.examples.some(example=>example.source_query_id === id)) return {status:200,value:saved};
    return {status:201,value:await createExample(row,'review',id)};
  }
  return {snapshot,createExample,importExamples,deleteExample,editExample,reviewExample,queries,createQuery,reviewQuery};
}
