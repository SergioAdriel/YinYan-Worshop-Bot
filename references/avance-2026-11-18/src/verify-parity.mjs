// Node >=18. Verifica probabilidades y tokens exportados contra scikit-learn.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'web/ml.js'), 'utf8');
const {createClassifier} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const classifier = createClassifier(JSON.parse(fs.readFileSync(path.join(root, 'web/model.json'), 'utf8')));
const reference = JSON.parse(fs.readFileSync(path.join(root, 'reports/parity_reference.json'), 'utf8'));
let maxError = 0;
for (const sample of reference) {
  const actual = classifier.predict(sample.text);
  assert.deepEqual(actual.tokens, sample.tokens, `Tokenización distinta: ${sample.text}`);
  assert.equal(actual.intent, sample.intent, `Clase distinta: ${sample.text}`);
  actual.probabilities.forEach((p, i) => {
    const error = Math.abs(p - sample.probabilities[i]);
    maxError = Math.max(maxError, error);
    assert.ok(error < 1e-10, `Probabilidad distinta: ${sample.text}, clase ${i}, error ${error}`);
  });
}
console.log(JSON.stringify({passed: reference.length, tolerance: 1e-10, maxProbabilityError: maxError, model: classifier.modelName}, null, 2));
