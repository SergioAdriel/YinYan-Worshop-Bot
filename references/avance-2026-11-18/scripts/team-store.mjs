/** Registros inmutables por aportación para compartir el proyecto mediante Git. */
import {readFile,writeFile,mkdir,readdir,link,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';

export const TIMEZONE = 'America/Mexico_City';
const AUTHORS = ['alumno-a','alumno-b'];
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
  if(!AUTHORS.includes(value)) throw apiError('Elige uno de los dos estudiantes.');
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

export function createTeamStore({project,runtime}) {
  const folder = resolve(process.env.YINYAN_TEAM_DIR || (process.env.YINYAN_DATA_DIR ? resolve(runtime,'team-records') : resolve(project,'data/team')));
  const legacy = resolve(runtime,'student-examples.json');
  const marker = resolve(runtime,'migration-complete.json');
  let migrating;

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
  async function snapshot() {
    await migrate();
    const deleted = new Set((await records('deletions')).map(row=>row.example_id));
    const examples = (await records('examples')).filter(row=>!deleted.has(row.id)).map(record=>{
      const row = {};
      for(const name of ['id','text','intent','author','created_at','timezone','timestamp_kind','source']) row[name] = record[name];
      if(record.source_query_id) row.source_query_id = record.source_query_id;
      return row;
    });
    return {examples,revision:hash(JSON.stringify(examples))};
  }
  async function createExample(data,source='manual',sourceQueryId=null) {
    const clean = cleanExample(data);
    const {examples} = await snapshot();
    if(examples.some(row=>key(row.text) === key(clean.text))) throw apiError('Esa consulta ya existe. Revisa su categoría en la lista.',409);
    if(examples.length >= 500) throw apiError('Puedes guardar hasta 500 ejemplos propios.');
    const row = {id:randomUUID(),...clean,created_at:new Date().toISOString(),timezone:TIMEZONE,timestamp_kind:'recorded',source};
    if(sourceQueryId) row.source_query_id = sourceQueryId;
    await append(pathFor(row.author,'examples',row.id),row);
    return snapshot();
  }
  async function importExamples(data) {
    if(!data || !Array.isArray(data.examples) || data.examples.length > 500) throw apiError('Importa un JSON con examples y un máximo de 500 ejemplos.');
    const rows = data.examples.map(cleanExample);
    const {examples} = await snapshot();
    const known = new Map(examples.map(row=>[key(row.text),row.intent]));
    const additions = [];
    for(const row of rows) {
      const normalized = key(row.text);
      if(known.has(normalized)) {
        if(known.get(normalized) !== row.intent) throw apiError('Una consulta importada tiene dos categorías distintas. Corrígela antes de importar.',409);
        continue;
      }
      known.set(normalized,row.intent); additions.push(row);
    }
    if(examples.length+additions.length > 500) throw apiError('Puedes guardar hasta 500 ejemplos propios.');
    for(const row of additions) await createExample(row);
    return snapshot();
  }
  async function deleteExample(id,data={}) {
    id = uuidId(id);
    const example = (await snapshot()).examples.find(row=>row.id === id);
    if(!example) throw apiError('No se encontró ese ejemplo.',404);
    if(!data || typeof data !== 'object' || Array.isArray(data)) throw apiError('El contenido debe ser un objeto.');
    const author = authorValue(data.author === undefined ? example.author : data.author);
    const row = {id:randomUUID(),example_id:id,author,created_at:new Date().toISOString(),timezone:TIMEZONE};
    await append(pathFor(author,'deletions',row.id),row);
    return snapshot();
  }
  function cleanQuery(data) {
    if(!data || typeof data !== 'object' || Array.isArray(data)) throw apiError('La consulta debe ser un objeto.');
    const session_id = textValue(data.session_id,1,80);
    const author = authorValue(data.author);
    const intent = data.intent ?? null;
    if(intent !== null && !['aclaracion','desconocida','seguridad'].includes(intent)) intentValue(intent);
    if(typeof data.accepted !== 'boolean') throw apiError('La consulta debe indicar si la predicción fue aceptada.');
    if(!data.model || !['simulation','custom'].includes(data.model.kind)) throw apiError('Indica el modelo utilizado en la consulta.');
    const model = {kind:data.model.kind};
    if(model.kind === 'simulation') {
      if(!Number.isInteger(data.model.day) || data.model.day < 1 || data.model.day > 15) throw apiError('El día del modelo debe estar entre 1 y 15.');
      model.day = data.model.day;
    } else if(data.model.revision !== undefined && data.model.revision !== null) model.revision = textValue(data.model.revision,1,128);
    return {session_id,author,text:textValue(data.text,1,1200),response:textValue(data.response,1,6000),intent,accepted:data.accepted,model,resolution:data.resolution == null ? null : textValue(data.resolution,1,80)};
  }
  async function queries() {
    const {examples} = await snapshot();
    const reviewed = new Map(examples.filter(row=>row.source_query_id).map(row=>[row.source_query_id,row.id]));
    const rows = (await records('queries')).map(row=>({...row,reviewed:reviewed.has(row.id),...(reviewed.has(row.id) ? {example_id:reviewed.get(row.id)} : {})}));
    return {queries:rows,timezone:TIMEZONE};
  }
  async function createQuery(data) {
    const clean = cleanQuery(data);
    const id = data.id === undefined ? randomUUID() : uuidId(data.id);
    const old = (await records('queries')).find(row=>row.id === id);
    if(old) {
      if(JSON.stringify(cleanQuery(old)) !== JSON.stringify(clean)) throw apiError('Ese identificador ya pertenece a otra consulta.',409);
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
  return {snapshot,createExample,importExamples,deleteExample,queries,createQuery,reviewQuery};
}
