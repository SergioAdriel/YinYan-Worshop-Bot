import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConversation } from '../web/dialogue.js';
import { createClassifier } from '../web/ml.js';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = [];
const realConversations = [];
const history = JSON.parse(fs.readFileSync(path.join(project, 'data', 'training', 'training_history.json'), 'utf8'));
const active = JSON.parse(fs.readFileSync(path.join(project, 'data', 'training', 'active.json'), 'utf8'));
const activeVersionId = active.active_id || history.references.base_id;
const realClassifier = createClassifier(JSON.parse(fs.readFileSync(path.join(project, 'data', 'training', 'runs', activeVersionId, 'model.json'), 'utf8')));
const predicted = (intent, accepted = true) => ({ intent, accepted, confidence: accepted ? 0.85 : 0.12, margin: accepted ? 0.7 : 0.01, knownRatio: accepted ? 0.8 : 0.1, alternatives: [{ intent, confidence: accepted ? 0.85 : 0.12 }] });
function scripted(mapping = {}) {
  return { predict: text => predicted(mapping[text] || 'ayuda', Boolean(mapping[text])) };
}
function record(name, fn, source = 'deterministic') {
  test(name, async () => {
    try { await fn(); cases.push({ name, source, passed: true }); }
    catch (error) { cases.push({ name, source, passed: false, detail: error.message }); throw error; }
  });
}

record('Tres turnos relacionados conservan y utilizan equipo y síntoma', () => {
  const c = createConversation(scripted({ 'Mi laptop no enciende': 'encendido' }));
  const first = c.reply('Mi laptop no enciende');
  assert.equal(first.intent, 'encendido');
  assert.equal(c.state.device, 'computadora');
  assert.equal(c.state.stage, 'pregunta_1');
  const second = c.reply('No');
  assert.match(second.text, /computadora/);
  assert.match(second.text, /otro enchufe/);
  assert.equal(c.state.stage, 'pregunta_2');
  const third = c.reply('Sí');
  assert.match(third.text, /computadora/);
  assert.match(third.text, /no enciende/);
  assert.equal(c.state.stage, 'orientacion');
  assert.equal(c.state.details.respuesta_1, 'no');
  assert.equal(c.state.details.respuesta_2, 'si');
  assert.equal(c.state.turnCount, 3);
});

record('El primer seguimiento cambia según la respuesta de encendido', () => {
  const c = createConversation(scripted({ 'Mi computadora no prende': 'encendido' }));
  c.reply('Mi computadora no prende');
  const r = c.reply('Sí');
  assert.match(r.text, /pantalla permanece negra/);
});

record('Solicitud de dispositivo recupera la falla pendiente', () => {
  const c = createConversation(scripted({ 'No carga': 'carga' }));
  c.reply('No carga');
  assert.equal(c.state.stage, 'dispositivo');
  const r = c.reply('Es un celular');
  assert.equal(c.state.issue, 'carga');
  assert.equal(c.state.device, 'celular');
  assert.equal(c.state.stage, 'pregunta_1');
  assert.match(r.text, /indicador de carga/);
});

record('Un nuevo síntoma no se confunde con la selección de dispositivo', () => {
  const c = createConversation(scripted({ 'No enciende': 'encendido', 'Mi celular no carga': 'carga' }));
  c.reply('No enciende');
  const r = c.reply('Mi celular no carga');
  assert.equal(r.intent, 'carga');
  assert.equal(c.state.issue, 'carga');
  assert.match(r.text, /indicador de carga/);
});

record('Cambio de síntoma durante seguimiento conserva equipo y reinicia preguntas', () => {
  const c = createConversation(scripted({ 'Mi consola se calienta': 'temperatura', 'No tiene sonido': 'sonido' }));
  c.reply('Mi consola se calienta');
  const r = c.reply('No tiene sonido');
  assert.equal(r.intent, 'sonido');
  assert.equal(c.state.issue, 'sonido');
  assert.equal(c.state.device, 'consola');
  assert.equal(c.state.stage, 'pregunta_1');
});

record('Cambiar de equipo evita heredar respuestas del equipo anterior', () => {
  const c = createConversation(scripted({ 'Mi laptop no enciende': 'encendido', 'Mi consola no enciende': 'encendido' }));
  c.reply('Mi laptop no enciende');
  c.reply('No');
  c.reply('Mi consola no enciende');
  assert.equal(c.state.device, 'consola');
  assert.equal(c.state.stage, 'pregunta_1');
  assert.deepEqual(c.state.details, { descripcion: 'Mi consola no enciende' });
});

record('Una respuesta sí aislada solicita una consulta completa', () => {
  const c = createConversation(scripted());
  const r = c.reply('Sí');
  assert.equal(r.intent, 'aclaracion');
  assert.equal(c.state.issue, null);
});

record('Pregunta ajena al dominio no avanza un seguimiento activo', () => {
  const c = createConversation(scripted({ 'Mi computadora está lenta': 'rendimiento' }));
  c.reply('Mi computadora está lenta');
  const r = c.reply('¿Quién ganó el juego de fútbol?');
  assert.equal(r.intent, 'desconocida');
  assert.equal(c.state.stage, 'pregunta_1');
  assert.deepEqual(c.state.details, { descripcion: 'Mi computadora está lenta' });
});

record('Una pregunta de precio no se procesa como respuesta de audio', () => {
  const c = createConversation(scripted({ 'Mi consola no tiene sonido': 'sonido', '¿Cuánto cuesta reparar el sonido?': 'presupuesto' }));
  c.reply('Mi consola no tiene sonido');
  const r = c.reply('¿Cuánto cuesta reparar el sonido?');
  assert.equal(r.intent, 'presupuesto');
  assert.equal(c.state.stage, 'pregunta_1');
  assert.match(r.text, /taller|Instagram/);
  assert.doesNotMatch(r.text, /\$\s*\d/);
});

record('Entidad dentro de consulta rechazada no reemplaza al equipo activo', () => {
  const c = createConversation(scripted({ 'Mi consola se calienta': 'temperatura' }));
  c.reply('Mi consola se calienta');
  const r = c.reply('Quiero comprar una laptop para viajar');
  assert.equal(r.intent, 'desconocida');
  assert.equal(c.state.device, 'consola');
});

record('Síntomas múltiples solicitan una prioridad', () => {
  const c = createConversation(scripted({ 'Mi celular no carga y pantalla negra': 'carga', 'No carga': 'carga' }));
  const multi = c.reply('Mi celular no carga y pantalla negra');
  assert.equal(multi.intent, 'aclaracion');
  assert.equal(c.state.pending.kind, 'elegir_falla');
  const chosen = c.reply('No carga');
  assert.equal(chosen.intent, 'carga');
  assert.equal(c.state.stage, 'pregunta_1');
});

record('Líquidos activan orientación segura incluso con clasificación rechazada', () => {
  const c = createConversation(scripted());
  const r = c.reply('Le cayó agua a mi celular');
  assert.equal(r.intent, 'liquidos');
  assert.equal(r.safety, true);
  assert.match(r.text, /no.*carg|no conectes cargadores/i);
  assert.match(r.text, /arroz/);
  assert.equal(c.state.device, 'celular');
});

record('Batería hinchada interrumpe diagnóstico ordinario', () => {
  const c = createConversation(scripted({ 'Mi celular no carga': 'carga' }));
  c.reply('Mi celular no carga');
  const r = c.reply('La batería está hinchada');
  assert.equal(r.intent, 'seguridad');
  assert.equal(r.safety, true);
  assert.equal(c.state.pending, null);
  assert.match(r.text, /no vuelvas a cargar/);
  assert.match(r.text, /No abras/);
});

record('Contacto no inventa dirección, horario o cita', () => {
  const c = createConversation(scripted({ '¿Dónde están?': 'contacto' }));
  const r = c.reply('¿Dónde están?');
  assert.equal(r.intent, 'contacto');
  assert.equal(r.actions[0].url, 'https://www.instagram.com/yinyan_workshop/');
  assert.match(r.text, /confirm|verificad/);
});

record('Nueva conversación elimina contexto e historial anteriores', () => {
  const c = createConversation(scripted({ 'Mi laptop no enciende': 'encendido' }));
  c.reply('Mi laptop no enciende');
  c.reply('No');
  const r = c.reply('Nueva conversación');
  assert.equal(r.intent, 'saludo');
  assert.equal(c.state.device, null);
  assert.equal(c.state.issue, null);
  assert.equal(c.state.turnCount, 0);
  assert.deepEqual(c.state.details, {});
  assert.equal(c.state.history.length, 1);
  assert.equal(c.reply('Sí').intent, 'aclaracion');
});

record('El resumen usa detalles del seguimiento sin prometer un servicio', () => {
  const c = createConversation(scripted({ 'Mi celular no carga': 'carga' }));
  c.reply('Mi celular no carga');
  c.reply('No');
  c.reply('Sí');
  const summary = c.getSummary();
  assert.match(summary, /Equipo: celular/);
  assert.match(summary, /carga o batería/);
  assert.match(summary, /Descripción inicial: Mi celular no carga/);
  assert.match(summary, /Primer seguimiento: no/);
  assert.match(summary, /no es un diagnóstico, cotización ni cita/);
});

record('Un seguimiento explícito después de la orientación utiliza el síntoma anterior', () => {
  const c = createConversation(scripted({ 'Mi celular no carga': 'carga' }));
  c.reply('Mi celular no carga');
  c.reply('No');
  c.reply('Sí');
  const r = c.reply('¿Y ahora qué hago?');
  assert.equal(r.intent, 'carga');
  assert.match(r.text, /celular/);
  assert.match(r.text, /revisión física/);
});

record('Tres variantes de respuesta evitan un saludo repetido literal', () => {
  const c = createConversation(scripted({ Hola: 'saludo' }));
  const variants = [c.reply('Hola').text, c.reply('Hola').text, c.reply('Hola').text];
  assert.equal(new Set(variants).size, 3);
});

record('Mensaje vacío y longitud excesiva se manejan sin clasificar', () => {
  const c = createConversation({ predict() { throw new Error('No debe llamarse'); } });
  assert.equal(c.reply('  ').intent, 'aclaracion');
  assert.equal(c.reply('a'.repeat(1501)).intent, 'aclaracion');
  assert.equal(c.state.turnCount, 0);
});

record('Error del clasificador produce un mensaje recuperable', () => {
  const c = createConversation({ predict() { throw new Error('modelo dañado'); } });
  const r = c.reply('Mi computadora falla');
  assert.equal(r.intent, 'desconocida');
  assert.equal(r.accepted, false);
});

record('Modelo real: tres turnos de encendido y seguimiento contextual', () => {
  const c = createConversation(realClassifier);
  const transcript = ['Mi computadora no enciende', 'No', 'Sí', '¿Y ahora qué hago?'].map(text => ({ user: text, response: c.reply(text) }));
  realConversations.push({ scenario: 'encendido_multiturno', transcript });
  assert.equal(transcript[0].response.intent, 'encendido');
  assert.equal(transcript[0].response.accepted, true);
  assert.equal(transcript[1].response.context.stage, 'pregunta_2');
  assert.equal(transcript[2].response.context.stage, 'orientacion');
  assert.match(transcript[3].response.text, /computadora/);
  assert.match(transcript[3].response.text, /revisión física/);
}, 'real_model');

record('Modelo real: paráfrasis de fallas distintas', () => {
  const examples = [
    ['Mi laptop está lentísima al abrir programas', 'rendimiento'],
    ['El teléfono dejó de reconocer el cargador', 'carga'],
    ['No puedo conectar mi PC a la red inalámbrica', 'conexion'],
    ['La pantalla de mi celular tiene rayas', 'pantalla'],
  ];
  const evidence = examples.map(([text, expected]) => ({ text, expected, prediction: realClassifier.predict(text), response: createConversation(realClassifier).reply(text) }));
  realConversations.push({ scenario: 'parafrasis', evidence });
  for (const row of evidence) {
    assert.equal(row.prediction.intent, row.expected, row.text);
    assert.equal(row.prediction.accepted, true, row.text);
    assert.equal(row.response.intent, row.expected, row.text);
  }
}, 'real_model');

record('Modelo real: consulta ambigua y pregunta fuera de dominio', () => {
  const c = createConversation(realClassifier);
  const ambiguous = c.reply('No funciona');
  const outside = c.reply('¿Quién ganó el partido de fútbol?');
  realConversations.push({ scenario: 'ambiguedad_fuera_dominio', responses: [{ user: 'No funciona', response: ambiguous }, { user: '¿Quién ganó el partido de fútbol?', response: outside }] });
  assert.equal(ambiguous.intent, 'aclaracion');
  assert.equal(outside.intent, 'desconocida');
  assert.equal(c.state.issue, null);
}, 'real_model');

record('Modelo real: precios y contacto no inventan datos del negocio', () => {
  const c = createConversation(realClassifier);
  const cost = c.reply('¿Cuánto cuesta reparar mi equipo?');
  const location = c.reply('¿Dónde están ubicados?');
  realConversations.push({ scenario: 'presupuesto_contacto', responses: [{ user: '¿Cuánto cuesta reparar mi equipo?', response: cost }, { user: '¿Dónde están ubicados?', response: location }] });
  assert.equal(cost.intent, 'presupuesto');
  assert.equal(location.intent, 'contacto');
  assert.doesNotMatch(cost.text, /\$\s*\d/);
  assert.equal(location.actions[0].url, 'https://www.instagram.com/yinyan_workshop/');
}, 'real_model');

record('Modelo real: reinicio no conserva equipo ni interpreta sí/no aislados', () => {
  const c = createConversation(realClassifier);
  c.reply('Mi celular no carga');
  const reset = c.reply('Nueva conversación');
  const isolated = c.reply('No');
  realConversations.push({ scenario: 'reinicio', responses: [{ user: 'Nueva conversación', response: reset }, { user: 'No', response: isolated }] });
  assert.equal(reset.intent, 'saludo');
  assert.equal(isolated.intent, 'aclaracion');
  assert.equal(c.state.issue, null);
  assert.equal(c.state.device, null);
}, 'real_model');

record('Modelo real: cinco consultas rápidas de la interfaz', () => {
  const examples = [
    ['Mi computadora está muy lenta', 'rendimiento'],
    ['Mi celular no carga', 'carga'],
    ['Mi consola se calienta mucho', 'temperatura'],
    ['Mi computadora no enciende', 'encendido'],
    ['El control de mi consola no responde', 'controles'],
  ];
  const evidence = examples.map(([text, expected]) => ({ text, expected, prediction: realClassifier.predict(text), response: createConversation(realClassifier).reply(text) }));
  realConversations.push({ scenario: 'consultas_rapidas_interfaz', evidence });
  for (const row of evidence) {
    assert.equal(row.prediction.accepted, true, row.text);
    assert.equal(row.response.intent, row.expected, row.text);
    assert.equal(row.response.context.stage, 'pregunta_1', row.text);
  }
}, 'real_model');

record('Modelo real: tres turnos de carga con detalles del indicador y cable', () => {
  const c = createConversation(realClassifier);
  const transcript = ['Mi celular no carga', 'No aparece el indicador de carga', 'El cable está dañado'].map(text => ({ user: text, response: c.reply(text) }));
  realConversations.push({ scenario: 'carga_multiturno', transcript });
  assert.equal(transcript[0].response.intent, 'carga');
  assert.equal(transcript[1].response.context.stage, 'pregunta_2');
  assert.equal(transcript[2].response.context.stage, 'orientacion');
  assert.equal(c.state.issue, 'carga');
  assert.equal(c.state.device, 'celular');
  assert.match(transcript[2].response.text, /celular/);
  assert.match(transcript[2].response.text, /compatible|revisión/);
}, 'real_model');

record('Modelo real: una receta recibe rechazo o redirección explícita al soporte', () => {
  const c = createConversation(realClassifier);
  c.reply('Mi celular no carga');
  const r = c.reply('Dame una receta de pastel');
  realConversations.push({ scenario: 'fuera_dominio_redireccion', responses: [{ user: 'Dame una receta de pastel', response: r }], note: 'El clasificador puede asignar ayuda a peticiones genéricas; el gestor redirige al soporte sin inventar una respuesta fuera del dominio.' });
  assert.ok(['desconocida', 'ayuda'].includes(r.intent));
  assert.match(r.text, /computadora|celular|consola|falla|equipo|soporte/);
  assert.equal(c.state.stage, 'pregunta_1');
  assert.equal(c.state.issue, 'carga');
  assert.doesNotMatch(r.text, /ingredientes|hornea|harina|azúcar/);
}, 'real_model');

record('Modelo real: contexto de líquido impide volver a conectar el equipo y permite contacto', () => {
  const c = createConversation(realClassifier);
  const transcript = ['Se cayó agua sobre mi laptop', '¿La puedo conectar para ver si funciona?', '¿Cómo contacto al taller?'].map(text => ({ user: text, response: c.reply(text) }));
  realConversations.push({ scenario: 'liquidos_contexto_seguro', transcript });
  assert.equal(transcript[0].response.intent, 'liquidos');
  assert.equal(transcript[1].response.intent, 'liquidos');
  assert.equal(transcript[1].response.safety, true);
  assert.match(transcript[1].response.text, /no.*(encender|conect|carg)/i);
  assert.equal(transcript[2].response.intent, 'contacto');
  assert.equal(transcript[2].response.actions[0].url, 'https://www.instagram.com/yinyan_workshop/');
}, 'real_model');

after(() => {
  fs.mkdirSync(path.join(project, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(project, 'reports', 'conversation-results.json'), JSON.stringify({
    scope: '20 pruebas deterministas aíslan el gestor con clasificación inyectada; 9 pruebas de integración utilizan el modelo supervisado realmente entrenado. source distingue cada caso. realConversations conserva evidencia de respuestas reales.',
    total: cases.length, passed: cases.filter(row => row.passed).length,
    failed: cases.filter(row => !row.passed).length, cases, realConversations,
  }, null, 2) + '\n', 'utf8');
});
