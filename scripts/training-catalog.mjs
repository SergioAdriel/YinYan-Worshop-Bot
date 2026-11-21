/** Read the official training catalog without requiring a Python process. */
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid=message=>Object.assign(new Error(message),{status:500});
export async function trainingCatalog(project) {
  const path=resolve(project,'data/training/training_history.json');
  let catalog;
  try {catalog=JSON.parse(await readFile(path,'utf8'));}
  catch(error) {throw invalid(`No se pudo leer el catálogo oficial de entrenamiento: ${error.message}`);}
  if(!catalog.labels||!UUID.test(catalog.references?.base_id||'')||!catalog.references?.stages) throw invalid('El catálogo oficial de entrenamiento está incompleto.');
  return catalog;
}
export async function referenceSource(project) {
  const catalog=await trainingCatalog(project);
  const folder=resolve(project,'data/training/runs',catalog.references.base_id);
  const [snapshot,model,version]=await Promise.all(['snapshot.json','model.json','run.json'].map(async name=>JSON.parse(await readFile(resolve(folder,name),'utf8'))));
  const examples=snapshot.training_examples||snapshot.base_examples;
  if(!Array.isArray(examples)||!examples.length||!model.preprocessing) throw invalid('La referencia oficial no contiene datos y preprocesamiento válidos.');
  return {labels:catalog.labels,examples,curve:catalog.reference_curve||[],base_id:catalog.references.base_id,
    stages:catalog.references.stages,model,version,folder};
}
export async function storedQueryModel(project,model) {
  if(model&&model.kind==='version'&&UUID.test(model.version_id||'')) return {kind:'version',version_id:model.version_id.toLowerCase()};
  if(Number.isInteger(model?.day)) {
    const catalog=await trainingCatalog(project);
    const id=catalog.references.stages[String(model.day)];
    if(UUID.test(id||'')) return {kind:'version',version_id:id};
  }
  throw invalid('Una consulta anterior no tiene una versión equivalente verificable en el catálogo. Conserva el registro original y revisa la migración.');
}
