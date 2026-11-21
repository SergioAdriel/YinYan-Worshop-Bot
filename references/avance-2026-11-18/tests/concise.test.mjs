import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversation} from '../web/dialogue.js';

const classifier = {predict: () => ({intent:'carga',accepted:true,confidence:0.7})};

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
