/** Import the preserved simulation references without executing a training run. */
import {readFile, writeFile, mkdir, link, unlink} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {csvRows} from './team-store.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const requireSource = (condition, message) => {
  if (!condition) throw new Error(`No se restauró el catálogo: ${message}`);
};

// UUIDv5 identifiers describe the imported stages, never a new training event.
function stageId(day) {
  const namespace = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex');
  const bytes = createHash('sha1').update(namespace)
    .update(`yinyan-workshop/imported-reference/stage/${day}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = bytes.toString('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

async function existing(path) {
  try { return await readFile(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function requireUnchanged(path, actual, expected) {
  if (actual && !actual.equals(expected)) {
    throw new Error(`Se conservó el archivo existente porque difiere de la referencia: ${path}. Revisa su procedencia antes de restaurar.`);
  }
}

// Publish completed bytes atomically and exclusively, including under two callers.
async function publish(path, content) {
  await mkdir(dirname(path), {recursive: true});
  const temporary = resolve(dirname(path), `.${randomUUID()}.reference.tmp`);
  try {
    await writeFile(temporary, content, {flag: 'wx'});
    try { await link(temporary, path); return true; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      requireUnchanged(path, await readFile(path), content);
      return false;
    }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export async function restoreTrainingCatalog(project = ROOT) {
  const sourceNames = ['data/simulation.json', 'web/simulation/manifest.json', 'data/test.csv'];
  const sourceBytes = await Promise.all(sourceNames.map(name => readFile(resolve(project, name))));
  const sourceHashes = Object.fromEntries(sourceNames.map((name, index) => [name, hash(sourceBytes[index])]));
  const source = JSON.parse(sourceBytes[0].toString('utf8'));
  const manifest = JSON.parse(sourceBytes[1].toString('utf8'));
  requireSource(source.simulated === true && manifest.simulated === true, 'las fuentes deben declarar su procedencia simulada.');
  requireSource(source.labels && equal(source.labels, manifest.labels), 'las etiquetas de las fuentes no coinciden.');
  requireSource(Array.isArray(source.days) && Array.isArray(manifest.days) && source.days.length === 15 && manifest.days.length === 15,
    'se requieren las quince etapas originales.');
  requireSource(manifest.evaluation?.sha256 === sourceHashes['data/test.csv'], 'el benchmark no coincide con el hash del manifiesto.');
  const csv = csvRows(sourceBytes[2].toString('utf8').replace(/^\uFEFF/, ''));
  const header = csv.shift() || [], textIndex = header.indexOf('text'), intentIndex = header.indexOf('intent');
  requireSource(textIndex >= 0 && intentIndex >= 0, 'el benchmark necesita las columnas text e intent.');
  const benchmark = csv.filter(row => row[textIndex]?.trim()).map(row => ({text: row[textIndex], intent: row[intentIndex]}));
  requireSource(benchmark.length === manifest.evaluation.total && benchmark.every(row => Object.hasOwn(source.labels, row.intent)),
    'el benchmark no conserva las consultas y etiquetas declaradas.');

  const planned = new Map(), references = {base_id: stageId(15), stages: {}}, curve = [];
  const cumulative = [], approvedRevision = hash('[]');
  const benchmarkBytes = json(benchmark);
  const provenance = 'Referencia importada de los artefactos originales de la simulación. Sus fechas describen el escenario ficticio; esta importación no ejecuta ni acredita una jornada de entrenamiento real.';
  for (let index = 0; index < 15; index++) {
    const day = source.days[index], stage = manifest.days[index], number = index + 1;
    requireSource(day.day === number && stage.day === number && equal(day.examples, stage.examples), `los ejemplos de la etapa ${number} no coinciden.`);
    requireSource(day.timestamp_kind === 'simulated' && stage.timestamp_kind === 'simulated'
      && ['title', 'note', 'date', 'started_at', 'ended_at', 'timezone'].every(key => day[key] === stage[key])
      && Number.isFinite(Date.parse(stage.started_at)) && Number.isFinite(Date.parse(stage.ended_at)),
    `la etapa ${number} debe conservar sus nombres y fechas simuladas.`);
    requireSource(Array.isArray(day.examples) && day.examples.every(row => row.timestamp_kind === 'simulated' && Object.hasOwn(source.labels, row.intent)),
      `la etapa ${number} contiene ejemplos sin procedencia o categoría válida.`);
    cumulative.push(...day.examples);
    const modelName = `web/simulation/day-${String(number).padStart(2, '0')}.json`;
    const modelBytes = await readFile(resolve(project, modelName)), model = JSON.parse(modelBytes.toString('utf8'));
    requireSource(model.model_type === 'naive_bayes' && model.simulated === true && model.simulation_day === number
      && model.trained_examples === cumulative.length && stage.total_examples === cumulative.length
      && equal([...model.classes].sort(), Object.keys(source.labels).sort()) && model.preprocessing,
    `el modelo de la etapa ${number} no corresponde a sus ejemplos.`);
    requireSource(['accuracy', 'precision_macro'].every(key => Number.isFinite(stage[key]) && stage[key] >= 0 && stage[key] <= 1)
      && stage.total === benchmark.length && Number.isInteger(stage.correct) && Number.isInteger(stage.accepted)
      && stage.correct >= 0 && stage.correct <= stage.total && stage.accepted >= 0 && stage.accepted <= stage.total
      && stage.accuracy === stage.correct / stage.total, `las métricas de la etapa ${number} no son válidas.`);
    const id = stageId(number), folder = `data/training/runs/${id}`;
    references.stages[String(number)] = id;
    const metrics = Object.fromEntries(['accuracy', 'precision_macro', 'correct', 'total', 'accepted'].map(key => [key, stage[key]]));
    curve.push({day: number, total_examples: cumulative.length, ...metrics});
    const snapshotBytes = json({base_examples: [...cumulative], additional_examples: [],
      training_examples: [...cumulative], approved_revision: approvedRevision});
    const counts = Object.fromEntries(Object.keys(source.labels).sort().map(intent => [intent, cumulative.filter(row => row.intent === intent).length]));
    const run = {
      format_version: 2, id, run_type: 'imported_reference', reference_stage: number, journey: 0,
      title: stage.title, note: stage.note, date: stage.date,
      created_at: stage.started_at, started_at: stage.started_at, finished_at: stage.ended_at,
      author: 'system', initiated_by: 'reference_import', timezone: stage.timezone,
      timestamp_kind: 'simulated', simulated: true, status: 'succeeded', approval_status: 'reference',
      dataset_version: hash(snapshotBytes), approved_revision: approvedRevision, message: provenance,
      counts: {base: cumulative.length, additional: 0, total: cumulative.length, test: benchmark.length,
        intents: Object.keys(source.labels).length, per_intent: counts},
      labels: Object.keys(source.labels).sort(), process_id: null, storage_path: `runs/${id}`,
      selected_model: 'naive_bayes', models: {naive_bayes: metrics},
      provenance: {description: provenance, source_stage: number, source_model: modelName},
      source_hashes: {...sourceHashes, [modelName]: hash(modelBytes)},
      artifact_hashes: {'snapshot.json': hash(snapshotBytes), 'model.json': hash(modelBytes), 'benchmark.json': hash(benchmarkBytes)},
    };
    planned.set(`${folder}/snapshot.json`, snapshotBytes);
    planned.set(`${folder}/model.json`, modelBytes);
    planned.set(`${folder}/benchmark.json`, benchmarkBytes);
    planned.set(`${folder}/run.json`, json(run));
  }
  const catalog = {format_version: 1, labels: source.labels, references, reference_curve: curve,
    participants: source.participants, calendar: source.calendar,
    provenance: {description: provenance, original: source.provenance}, source_hashes: sourceHashes};
  // Validate every source and every existing destination before creating any file.
  planned.set('data/training/training_history.json', json(catalog));
  for (const [name, content] of planned) requireUnchanged(name, await existing(resolve(project, name)), content);
  let created = 0;
  // The catalog is the last entry, so readers cannot discover incomplete references.
  for (const [name, content] of planned) if (await publish(resolve(project, name), content)) created++;
  return {references: 15, created_files: created, unchanged_files: planned.size - created,
    catalog: 'data/training/training_history.json', base_id: references.base_id};
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  restoreTrainingCatalog().then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
