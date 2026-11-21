/** Inferencia del clasificador realmente entrenado en Python.
 * TF-IDF palabras 1/2, tf sublineal, normalización L2 y softmax estable.
 * No hay reglas de síntomas ni llamadas a un servicio generativo.
 */
export function createClassifier(model) {
  if (model.format_version !== 1 || !Array.isArray(model.classes) || !Array.isArray(model.features)) {
    throw new Error('El formato del modelo no es compatible. Vuelve a entrenarlo.');
  }
  const stopwords = new Set(model.preprocessing.stopwords);
  const lemmas = model.preprocessing.lemma_map;
  const vocabulary = new Map(model.features.map((word, index) => [word, index]));
  const thresholds = model.thresholds;

  function tokenize(text) {
    const normalized = String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return (normalized.match(/[a-z0-9]+/g) || []).filter(word => !stopwords.has(word)).map(word => lemmas[word] || word);
  }

  function predict(text) {
    const tokens = tokenize(text);
    const terms = [...tokens];
    for (let i = 0; i < tokens.length - 1; i++) terms.push(`${tokens[i]} ${tokens[i + 1]}`);
    const counts = new Map();
    for (const term of terms) {
      const index = vocabulary.get(term);
      if (index !== undefined) counts.set(index, (counts.get(index) || 0) + 1);
    }
    const vector = [];
    let squaredNorm = 0;
    for (const [index, count] of counts) {
      const value = (1 + Math.log(count)) * model.idf[index];
      vector.push([index, value]);
      squaredNorm += value * value;
    }
    const norm = Math.sqrt(squaredNorm) || 1;
    const scores = model.weights.map((weights, classIndex) => {
      let score = model.intercept[classIndex];
      for (const [index, value] of vector) score += weights[index] * value / norm;
      return score;
    });
    const max = Math.max(...scores);
    const exp = scores.map(score => Math.exp(score - max));
    const total = exp.reduce((sum, value) => sum + value, 0);
    const probabilities = exp.map(value => value / total);
    const alternatives = model.classes.map((intent, i) => ({intent, confidence: probabilities[i]}))
      .sort((a, b) => b.confidence - a.confidence || a.intent.localeCompare(b.intent));
    const confidence = alternatives[0].confidence;
    const margin = confidence - alternatives[1].confidence;
    const knownRatio = tokens.length ? tokens.filter(token => vocabulary.has(token)).length / tokens.length : 0;
    return {
      intent: alternatives[0].intent, confidence, margin, knownRatio,
      accepted: tokens.length > 0 && confidence >= thresholds.confidence && margin >= thresholds.margin && knownRatio >= thresholds.knownRatio,
      alternatives: alternatives.slice(0, 3), probabilities, tokens,
      model: model.model_type
    };
  }
  return {predict, tokenize, modelName: model.model_type, classes: [...model.classes], thresholds: {...thresholds}};
}

export async function loadClassifier(url = './model.json') {
  if (url && typeof url === 'object') return createClassifier(url);
  const response = await fetch(url, {cache: 'no-cache'});
  if (!response.ok) throw new Error(`No se pudo cargar el modelo (${response.status}).`);
  return createClassifier(await response.json());
}
