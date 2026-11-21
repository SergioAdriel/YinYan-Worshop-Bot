import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClassifier } from '../web/ml.js';
import { createConversation } from '../web/dialogue.js';

const history = JSON.parse(fs.readFileSync(new URL('../data/training/training_history.json', import.meta.url), 'utf8'));
const classifiers = new Map(['08', '15'].map(day => [
  day,
  createClassifier(JSON.parse(fs.readFileSync(new URL(`../data/training/runs/${history.references.stages[String(Number(day))]}/model.json`, import.meta.url), 'utf8'))),
]));
const chatFor = day => createConversation(classifiers.get(day), { concise: true });
const hasContact = response => response.actions.some(action => action.url === 'https://www.instagram.com/yinyan_workshop/');
const normalized = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

for (const day of ['08', '15']) {
  test(`Día ${day}: un reinicio rechazado conserva el celular y pide distinguir equipo de pantalla`, () => {
    const chat = chatFor(day);
    const message = 'Hola mi telefono se apaga y se prende';
    assert.equal(classifiers.get(day).predict(message).accepted, false);
    const response = chat.reply(message);
    assert.equal(response.context.device, 'celular');
    assert.match(normalized(response.text), /pantalla/);
    assert.match(normalized(response.text), /reinici|todo el (equipo|celular)|equipo completo/);
    assert.ok(response.suggestions.length >= 2, 'Debe ofrecer opciones concretas para aclarar el síntoma.');
    assert.doesNotMatch(normalized(response.text), /prueba un cargador|revisa el enchufe/);
  });

  test(`Día ${day}: ipone se entiende como celular y no se confunde reinicio con falta de encendido`, () => {
    const chat = chatFor(day);
    const response = chat.reply('Se apaga y se prende, es un ipone');
    assert.equal(response.context.device, 'celular');
    assert.match(normalized(response.text), /pantalla/);
    assert.match(normalized(response.text), /reinici|todo el (equipo|celular)|equipo completo/);
    assert.doesNotMatch(response.text, /¿Te pasa en una computadora/);
    assert.doesNotMatch(response.text, /¿hay alguna luz, vibración o sonido/);
  });

  test(`Día ${day}: parpadia pide aclaración y cada sugerencia puede resolver o avanzar`, () => {
    const initialChat = chatFor(day);
    const first = initialChat.reply('mi celular parpadia cuando lo prendo para abrirlo');
    assert.equal(first.context.device, 'celular');
    assert.match(normalized(first.text), /pantalla/);
    assert.ok(first.suggestions.length >= 2);
    assert.doesNotMatch(normalized(first.text), /es la bateria|esta danad[ao]|cambia la pantalla/);
    for (const suggestion of first.suggestions) {
      const chat = chatFor(day);
      chat.reply('mi celular parpadia cuando lo prendo para abrirlo');
      const response = chat.reply(suggestion);
      assert.equal(response.context.device, 'celular', suggestion);
      assert.ok(response.text !== first.text || hasContact(response), `La opción «${suggestion}» no debe volver al mismo rechazo.`);
    }
  });

  test(`Día ${day}: la selección diferencia reinicios de un parpadeo de pantalla`, () => {
    const branches = [
      { choice: 'Se reinicia y sale el logo', issue: 'software', variant: 'reinicios' },
      { choice: 'Solo parpadea la pantalla', issue: 'pantalla', variant: 'parpadeo' },
    ];
    for (const branch of branches) {
      const chat = chatFor(day);
      const first = chat.reply('mi telefono parpadia');
      assert.ok(first.suggestions.includes(branch.choice), branch.choice);
      const response = chat.reply(branch.choice);
      assert.equal(response.context.device, 'celular');
      assert.equal(response.context.issue, branch.issue);
      assert.equal(chat.state.details.variant, branch.variant);
      assert.equal(response.resolution, 'user_choice');
      if (!classifiers.get(day).predict(branch.choice).accepted) assert.equal(response.accepted, false);
      assert.doesNotMatch(normalized(response.text), /otro enchufe|alguna luz, vibracion o sonido/);
      const followup = chat.reply('Si');
      assert.equal(followup.context.issue, branch.issue);
      assert.notEqual(followup.text, response.text);
      assert.doesNotMatch(normalized(followup.text), /revisa el enchufe/);
    }
  });

  test(`Día ${day}: no enciende conserva su seguimiento sin forzar un reinicio`, () => {
    const chat = chatFor(day);
    const response = chat.reply('Mi computadora no prende');
    assert.equal(response.intent, 'encendido');
    assert.equal(response.context.device, 'computadora');
    assert.match(response.text, /¿hay alguna luz, vibración o sonido/);
    assert.notEqual(chat.state.details.variant, 'reinicios');
  });

  test(`Día ${day}: una alerta interrumpe la aclaración de parpadeo`, () => {
    const chat = chatFor(day);
    chat.reply('mi telefono parpadia');
    const response = chat.reply('La bateria esta hinchada');
    assert.equal(response.safety, true);
    assert.equal(response.intent, 'seguridad');
    assert.match(normalized(response.text), /no vuelvas a cargar/);
    assert.equal(chat.state.pending, null);
    const followup = chat.reply('Se reinicia y sale el logo');
    assert.equal(followup.safety, true);
    assert.equal(followup.intent, 'seguridad');
    assert.doesNotMatch(normalized(followup.text), /prueba un reinicio|prueba.*cargador/);
  });

  test(`Día ${day}: la conversación reportada no produce cuatro rechazos idénticos`, () => {
    const chat = chatFor(day);
    const messages = [
      'mi celular parpadia cuando lo prendo para abrirlo',
      'mi telefono parpadia',
      'mi telefono parpadea',
      'se prende y se apaga mi telefono',
    ];
    const responses = messages.map(message => chat.reply(message));
    assert.ok(new Set(responses.map(response => response.text)).size > 1);
    assert.ok(responses.slice(1).some(hasContact), 'Los intentos repetidos deben ofrecer contacto con el taller.');
    for (const response of responses) assert.equal(response.context.device, 'celular');
  });

  test(`Día ${day}: compras de laptop no sustituyen la consola en revisión`, () => {
    const chat = chatFor(day);
    chat.reply('Mi consola se calienta mucho');
    assert.equal(chat.state.device, 'consola');
    const previousIssue = chat.state.issue;
    const response = chat.reply('Quiero comprar una laptop para viajar');
    assert.equal(response.context.device, 'consola');
    assert.equal(response.context.issue, previousIssue);
    assert.doesNotMatch(normalized(response.text), /te recomiendo comprar/);
  });

  test(`Día ${day}: una opción ofrecida tras un rechazo durante diagnóstico se puede seleccionar`, () => {
    const chat = chatFor(day);
    chat.reply('Mi celular no carga');
    const unknown = chat.reply('zarbuk nodal');
    assert.ok(unknown.suggestions.includes('Falla la pantalla'));
    const choice = chat.reply('Falla la pantalla');
    assert.equal(choice.context.device, 'celular');
    assert.equal(choice.context.issue, 'pantalla');
    assert.equal(choice.resolution, 'user_choice');
    assert.equal(choice.context.stage, 'pregunta_1');
    assert.notEqual(choice.text, unknown.text);
  });

  test(`Día ${day}: un nuevo equipo con parpadia no hereda el dispositivo ni la descripción anterior`, () => {
    const scenarios = [
      ['Mi celular no carga', 'Mi consola parpadia'],
      ['Mi celular no carga', 'mi telefono parpadia', 'Mi consola parpadia'],
    ];
    for (const messages of scenarios) {
      const chat = chatFor(day);
      let clarification;
      for (const message of messages) clarification = chat.reply(message);
      assert.equal(clarification.context.device, 'consola');
      const choice = chat.reply('Solo parpadea la pantalla');
      assert.equal(choice.context.device, 'consola');
      assert.equal(choice.context.issue, 'pantalla');
      assert.equal(chat.state.details.descripcion, 'Mi consola parpadia');
      assert.match(chat.getSummary(), /Equipo: consola/);
      assert.match(chat.getSummary(), /Descripción inicial: Mi consola parpadia/);
    }
  });

  test(`Día ${day}: la derivación conserva la consulta original en el resumen antes y después del contacto`, () => {
    const chat = chatFor(day);
    chat.reply('mi telefono parpadia');
    const referred = chat.reply('No estoy seguro');
    assert.ok(hasContact(referred));
    assert.match(chat.getSummary(), /mi telefono parpadia/);
    chat.reply('Contactar al taller');
    assert.match(chat.getSummary(), /mi telefono parpadia/);
  });
}

test('Dos rechazos consecutivos ofrecen una salida útil sin atribuir una falla al modelo', () => {
  const classifier = { predict: () => ({ intent: 'ayuda', accepted: false, confidence: 0.12 }) };
  const chat = createConversation(classifier, { concise: true });
  const first = chat.reply('zarbuk nodal');
  const second = chat.reply('todavia no logro decirlo');
  assert.equal(first.accepted, false);
  assert.equal(second.accepted, false);
  assert.notEqual(second.text, first.text);
  assert.ok(second.suggestions.length >= 2);
  assert.ok(hasContact(second));
  assert.equal(second.context.issue, null);
});

test('Nueva conversación borra los intentos de recuperación anteriores', () => {
  const classifier = { predict: () => ({ intent: 'ayuda', accepted: false, confidence: 0.12 }) };
  const chat = createConversation(classifier, { concise: true });
  const first = chat.reply('zarbuk nodal');
  chat.reply('todavia no logro decirlo');
  chat.reply('Nueva conversación');
  const restarted = chat.reply('zarbuk nodal');
  assert.equal(restarted.text, first.text);
  assert.equal(restarted.context.device, null);
  assert.equal(restarted.context.issue, null);
});
