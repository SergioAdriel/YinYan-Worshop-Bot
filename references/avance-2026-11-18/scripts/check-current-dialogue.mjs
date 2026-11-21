/** Evidencia reproducible del modelo activo y el modo sencillo de la página. */
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createClassifier} from '../web/ml.js';
import {createConversation} from '../web/dialogue.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modelPath = 'web/simulation/day-15.json';
const modelBytes = await readFile(resolve(root, modelPath));
const classifier = createClassifier(JSON.parse(modelBytes));
const source = JSON.parse(await readFile(resolve(root, 'data/simulation.json'), 'utf8'));
const trainingKeys = new Set(source.days.flatMap(day => day.examples).map(row => classifier.tokenize(row.text).join(' ')));
const scenarios = [];
const cases = [];
function chat() {return createConversation(classifier, {concise: true});}
function run(name, messages, verify) {
  const conversation = chat();
  const transcript = messages.map(user => ({user, response: conversation.reply(user),
    state: structuredClone(conversation.state)}));
  let failure;
  try {verify(conversation, transcript);} catch (error) {failure = error.message;}
  cases.push({name, passed: !failure, ...(failure ? {error: failure} : {})});
  scenarios.push({scenario: name, transcript});
}
run('Tres turnos de encendido utilizan equipo y respuestas previas',
  ['Mi computadora no prende', 'No', 'Sí'], (c, t) => {
    assert.equal(t[0].response.context.issue, 'encendido');
    assert.equal(t[1].response.context.device, 'computadora');
    assert.equal(t[1].response.context.stage, 'pregunta_2');
    assert.equal(t[2].response.context.stage, 'orientacion');
    assert.equal(c.state.details.respuesta_1, 'no');
    assert.equal(c.state.details.respuesta_2, 'si');
  });
run('Tres turnos de carga utilizan la comprobación del cable',
  ['Mi celular no carga', 'No', 'Sí'], (c, t) => {
    assert.equal(c.state.issue, 'carga');
    assert.equal(c.state.device, 'celular');
    assert.equal(t[1].response.context.stage, 'pregunta_2');
    assert.equal(t[2].response.context.stage, 'orientacion');
  });
run('Una expresión ambigua solicita aclaración', ['No funciona'], (c, t) => {
  assert.ok(['aclaracion', 'desconocida'].includes(t[0].response.intent));
  assert.equal(c.state.issue, null);
});
run('Una receta fuera del dominio no se contesta como soporte',
  ['Escríbeme una receta de pastel de chocolate'], (c, t) => {
    assert.ok(['aclaracion', 'desconocida'].includes(t[0].response.intent));
    assert.equal(c.state.issue, null);
  });
run('El parpadeo se aclara y conserva el celular durante tres turnos',
  ['mi telefono parpadia', 'Solo parpadea la pantalla', 'Sí'], (c, t) => {
    assert.equal(t[0].response.context.device, 'celular');
    assert.equal(t[1].response.resolution, 'user_choice');
    assert.equal(t[2].response.context.issue, 'pantalla');
    assert.equal(t[2].response.context.device, 'celular');
  });
run('Reiniciar elimina equipo, falla y respuestas pendientes',
  ['Mi celular no carga', 'No', 'Nueva conversación', 'Sí'], (c, t) => {
    assert.equal(t[2].response.context.device, null);
    assert.equal(t[2].response.context.issue, null);
    assert.deepEqual(t[2].state.details, {});
    assert.equal(t[3].response.intent, 'aclaracion');
    assert.equal(c.state.issue, null);
  });
run('El contexto de líquido conserva la precaución',
  ['Le cayó agua a mi celular', '¿Lo puedo conectar para ver si funciona?', '¿Cómo contacto al taller?'], (c, t) => {
    assert.equal(t[0].response.safety, true);
    assert.equal(t[1].response.safety, true);
    assert.ok(t[2].response.actions.some(action => action.url.includes('instagram.com')));
  });
const probeTexts = [
  'La batería de mi teléfono no aumenta aunque lo dejo conectado',
  'Cada que abro varias aplicaciones mi laptop se queda trabada',
  'Mi consola tiene imagen pero las bocinas no suenan',
  'La computadora detecta mi wifi pero no me deja navegar',
  'Mi celular se pone muy caliente al jugar durante un rato',
  'Mi laptop tarda una eternidad en abrir una carpeta',
];
const probes = probeTexts.map(text => ({text,
  absent_from_training_after_tokenization: !trainingKeys.has(classifier.tokenize(text).join(' ')),
  prediction: classifier.predict(text), response: chat().reply(text)}));
const repetitive = chat();
const greetings = Array.from({length: 3}, () => repetitive.reply('hola').text);
const report = {
  generated_at: new Date().toISOString(), model_path: modelPath,
  model_sha256: createHash('sha256').update(modelBytes).digest('hex'),
  configuration: {concise: true},
  scope: 'Pruebas funcionales del modelo base activo; no representan sesiones de alumnos ni una prueba final inédita.',
  total: cases.length, passed: cases.filter(row => row.passed).length,
  failed: cases.filter(row => !row.passed).length, cases, scenarios, probes,
  limitations: {repeated_greeting_unique_responses: new Set(greetings).size,
    note: 'El modo sencillo sustituye algunas variantes de plantilla por una respuesta fija. Las consultas exploratorias se muestran sin atribuirles una exactitud general.'},
};
await mkdir(resolve(root, 'reports'), {recursive: true});
await writeFile(resolve(root, 'reports/current-dialogue-results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({passed: report.passed, total: report.total, failed: report.failed,
  novel_probes: probes.filter(row => row.absent_from_training_after_tokenization).length,
  greeting_variants: report.limitations.repeated_greeting_unique_responses}));
if (report.failed) process.exitCode = 1;
