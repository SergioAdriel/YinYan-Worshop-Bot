import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversation} from '../web/dialogue.js';

const classifier = {predict: () => ({intent:'carga',accepted:true,confidence:0.7})};

test('El seguimiento usa el caso completo y una duda sobre la luz no reinicia el diagnóstico', () => {
  const inputs = [];
  const chat = createConversation({predict(text) {
    inputs.push(text);
    const intent = text.includes('no carga') ? 'carga' : inputs.length === 1 ? 'encendido' : 'pantalla';
    return {intent, accepted: true};
  }}, {concise: true});
  chat.reply('Mi laptop no enciende');
  assert.equal(chat.reply('Solo vibra').context.stage, 'pregunta_2');
  const doubt = chat.reply('¿Enciende una luz?');
  assert.equal(doubt.intent, 'encendido');
  assert.equal(doubt.context.stage, 'pregunta_2');
  assert.match(doubt.text, /pantalla muestra imagen/);
  assert.equal(inputs.at(-1), 'Mi laptop no enciende\nSolo vibra\n¿Enciende una luz?');
  assert.equal(chat.reply('La pantalla sigue negra').context.stage, 'orientacion');
  assert.equal(chat.reply('Otro problema: mi celular no carga').context.stage, 'pregunta_1');
  assert.equal(chat.reply('Sí').context.stage, 'pregunta_2');
  assert.equal(inputs.at(-1), 'Otro problema: mi celular no carga\nSí');
});

test('El modo sencillo mantiene el seguimiento y ofrece una orientación breve', () => {
  const chat = createConversation(classifier,{concise:true});
  assert.match(chat.reply('Mi celular no carga').text,/indicador de carga/);
  assert.match(chat.reply('No').text,/cable o el conector/);
  const answer = chat.reply('Sí');
  assert.equal(answer.context.stage,'orientacion');
  assert.equal(answer.context.device,'celular');
  assert.ok(answer.text.length < 200);
  assert.match(answer.text,/compatibles/);
  assert.match(chat.getSummary(),/Primer seguimiento: no/);
});

test('Una consulta desconocida pide aclaración y las alertas conservan las precauciones', () => {
  const chat = createConversation({predict:()=>({intent:'ayuda',accepted:false})},{concise:true});
  assert.match(chat.reply('zarbuk nodal').text,/No entendí/);
  const wet = chat.reply('Le cayó agua a mi celular');
  assert.equal(wet.safety,true);
  assert.match(wet.text,/no.*carg|no conectes cargadores/i);
  assert.match(wet.text,/arroz/);
  const battery = chat.reply('La batería está hinchada');
  assert.equal(battery.safety,true);
  assert.match(battery.text,/no vuelvas a cargar/);
});

test('Una frase sin síntoma pide aclaración aunque el clasificador tenga confianza alta', () => {
  const chat = createConversation({predict: () => ({intent: 'controles', accepted: true, confidence: .95})}, {concise: true});
  const response = chat.reply('No funciona');
  assert.equal(response.intent, 'aclaracion');
  assert.equal(response.accepted, false);
  assert.equal(chat.state.issue, null);
  assert.match(response.text, /exactamente/);
});

for (const intent of ['saludo', 'despedida', 'ayuda', 'presupuesto', 'contacto']) {
  test(`El modo sencillo conserva tres variantes de ${intent}`, () => {
    const chat = createConversation({predict: () => ({intent, accepted: true, confidence: .9})}, {concise: true});
    const answers = Array.from({length: 3}, () => chat.reply('Consulta para el taller').text);
    assert.equal(new Set(answers).size, 3);
    assert.ok(answers.every(text => text.length > 20));
  });
}

for (const intent of ['encendido', 'carga', 'temperatura', 'rendimiento', 'conexion', 'pantalla', 'sonido', 'almacenamiento', 'software', 'controles']) {
  test(`La orientación breve de ${intent} varía sin perder el contexto`, () => {
    const chat = createConversation({predict: () => ({intent, accepted: true, confidence: .9})}, {concise: true});
    chat.reply('Mi computadora presenta una falla');
    chat.reply('No');
    const answers = [chat.reply('Sí'), chat.reply('¿Y ahora qué hago?'), chat.reply('¿Y ahora qué hago?')];
    assert.equal(new Set(answers.map(answer => answer.text)).size, 3);
    assert.ok(answers.every(answer => answer.context.device === 'computadora' && answer.context.issue === intent));
    assert.ok(answers.every(answer => answer.text.length <= 230));
  });
}
