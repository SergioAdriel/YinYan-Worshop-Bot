import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createClassifier} from '../web/ml.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = path => readFile(resolve(root, path), 'utf8').then(JSON.parse);
const manifest = await readJson('web/simulation/manifest.json');
const corpus = await readJson('data/simulation.json');
const evidence = await readJson('reports/simulation-predictions.json');
const parity = await readJson('reports/simulation-parity.json');
const canonicalText = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {field += '"'; index++;}
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {row.push(field); field = '';}
    else if (character === '\n' && !quoted) {row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = '';}
    else field += character;
  }
  if (field || row.length) {row.push(field.replace(/\r$/, '')); rows.push(row);}
  assert.equal(quoted, false, 'CSV con comillas sin cerrar.');
  const [headers, ...values] = rows;
  return values.filter(value => value.some(Boolean)).map(value => Object.fromEntries(headers.map((header, index) => [header, value[index]])));
}

const evaluation = parseCsv(await readFile(resolve(root, 'data/test.csv'), 'utf8'));
const loadedDays = await Promise.all(manifest.days.map(async day => {
  assert.match(day.model_url, /^\.\/simulation\/day-\d{2}\.json$/);
  const path = resolve(root, 'web', day.model_url);
  assert.ok(path.startsWith(resolve(root, 'web/simulation') + sep));
  const serialized = await readFile(path, 'utf8');
  const model = JSON.parse(serialized);
  return {...day, model, classifier: createClassifier(model), hash: createHash('sha256').update(serialized).digest('hex')};
}));

function close(actual, expected, label, tolerance = 1e-10) {
  assert.equal(typeof actual, 'number', label);
  assert.ok(Number.isFinite(actual), label);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} frente a ${expected}`);
}

function macroPrecision(predictions, classes) {
  return classes.reduce((sum, intent) => {
    const selected = predictions.filter(row => row.predicted === intent);
    return sum + (selected.length ? selected.filter(row => row.expected === intent).length / selected.length : 0);
  }, 0) / classes.length;
}

test('La práctica declara 15 días simulados y separa a quienes alimentan de quienes consultan', () => {
  assert.equal(manifest.format_version, 1);
  assert.equal(manifest.simulated, true);
  assert.equal(corpus.simulated, true);
  assert.equal(manifest.target_accuracy, 0.85, '85 % es el objetivo declarado, no una tasa inyectada.');
  assert.deepEqual(manifest.days.map(day => day.day), Array.from({length: 15}, (_, index) => index + 1));
  assert.deepEqual(corpus.days.map(day => day.day), manifest.days.map(day => day.day));
  assert.deepEqual(new Set(manifest.participants.filter(row => row.role === 'training').map(row => row.id)), new Set(['alumno-a', 'alumno-b']));
  assert.deepEqual(new Set(manifest.participants.filter(row => row.role === 'testing').map(row => row.id)), new Set(['prueba-c', 'prueba-d']));
  assert.deepEqual(corpus.participants, manifest.participants);
  assert.equal(manifest.evaluation.total, evaluation.length);
  assert.equal(new Set(loadedDays.map(day => day.hash)).size, 15, 'Cada día carga su propio modelo entrenado.');
});

test('Los ejemplos se acumulan, llevan autor y no incluyen las consultas de evaluación', () => {
  let total = 0;
  const ids = new Set();
  const testTexts = new Set(evaluation.map(row => canonicalText(row.text)));
  const authors = new Set();
  const queryAuthors = new Set();
  for (const day of loadedDays) {
    const source = corpus.days.find(row => row.day === day.day);
    assert.deepEqual(day.examples, source.examples, `Ejemplos del día ${day.day}.`);
    assert.equal(day.added_examples, day.examples.length);
    total += day.examples.length;
    assert.equal(day.total_examples, total);
    assert.ok(day.examples.length > 0);
    for (const row of day.examples) {
      assert.equal(typeof row.id, 'string'); assert.ok(!ids.has(row.id)); ids.add(row.id);
      assert.ok(['alumno-a', 'alumno-b'].includes(row.author)); authors.add(row.author);
      assert.ok(Object.hasOwn(manifest.labels, row.intent));
      assert.equal(typeof row.text, 'string'); assert.ok(row.text.length >= 3);
      assert.equal(testTexts.has(canonicalText(row.text)), false, `Fuga de evaluación: ${row.text}`);
    }
    assert.ok(day.queries.length > 0);
    for (const row of day.queries) {
      assert.ok(['prueba-c', 'prueba-d'].includes(row.author)); queryAuthors.add(row.author);
      const sourceQuery = source.queries.find(item => item.id === row.id);
      assert.ok(sourceQuery);
      assert.equal(sourceQuery.text, row.text);
      assert.equal(sourceQuery.expected, row.expected);
    }
  }
  assert.deepEqual(authors, new Set(['alumno-a', 'alumno-b']));
  assert.deepEqual(queryAuthors, new Set(['prueba-c', 'prueba-d']));
  assert.ok(total > loadedDays[0].total_examples);
});

test('Exactitud y precisión macro se calculan con las mismas consultas fijas en los 15 días', () => {
  assert.equal(evidence.days.length, 15);
  for (const day of loadedDays) {
    const recorded = evidence.days.find(row => row.day === day.day);
    assert.ok(recorded, `Sin predicciones del día ${day.day}.`);
    assert.equal(recorded.predictions.length, evaluation.length);
    assert.equal(day.total, evaluation.length);
    const actual = evaluation.map((row, index) => {
      const prediction = day.classifier.predict(row.text);
      const saved = recorded.predictions[index];
      assert.equal(saved.text, row.text);
      assert.equal(saved.expected, row.intent);
      assert.equal(saved.predicted, prediction.intent, `Día ${day.day}: ${row.text}`);
      assert.equal(saved.accepted, prediction.accepted);
      assert.equal(saved.correct, prediction.intent === row.intent);
      return {expected: row.intent, predicted: prediction.intent};
    });
    const correct = actual.filter(row => row.predicted === row.expected).length;
    assert.equal(day.correct, correct);
    close(day.accuracy, correct / evaluation.length, `Exactitud del día ${day.day}`);
    close(day.precision_macro, macroPrecision(actual, day.model.classes), `Precisión macro del día ${day.day}`);
  }
  assert.ok(loadedDays.at(-1).accuracy > loadedDays[0].accuracy, 'Los datos añadidos mejoran el resultado respecto al inicio.');
});

test('Las consultas diarias muestran predicciones auténticas y errores reproducibles', () => {
  for (const day of loadedDays) {
    for (const row of day.queries) {
      const prediction = day.classifier.predict(row.text);
      assert.equal(row.predicted, prediction.intent, `Día ${day.day}, consulta ${row.id}.`);
      assert.equal(row.correct, prediction.intent === row.expected);
      assert.equal(row.accepted, prediction.accepted);
      assert.deepEqual(day.classifier.predict(row.text), prediction, 'No se sortean errores artificiales.');
    }
  }
});

test('Los 15 modelos de navegador coinciden con las referencias de Python', () => {
  assert.ok(Array.isArray(parity));
  for (const day of loadedDays) {
    const references = parity.filter(row => row.day === day.day);
    assert.ok(references.length >= 7, `Faltan referencias de Python para el día ${day.day}.`);
    for (const row of references) {
      const actual = day.classifier.predict(row.text);
      assert.deepEqual(actual.tokens, row.tokens);
      assert.equal(actual.intent, row.intent, `Día ${day.day}: ${row.text}`);
      assert.equal(actual.accepted, row.accepted);
      assert.equal(actual.probabilities.length, row.probabilities.length);
      actual.probabilities.forEach((value, index) => close(value, row.probabilities[index], `Día ${day.day}, clase ${index}`));
    }
  }
});
