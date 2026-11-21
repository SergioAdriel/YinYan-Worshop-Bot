"""Shared text pipelines and canonical reference data for versioned training."""
from __future__ import annotations
import json
from pathlib import Path

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import accuracy_score, precision_score, precision_recall_fscore_support, confusion_matrix, classification_report
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline
from src.preprocessing import LEMMA_MAP, STOPWORDS, normalize, tokenize

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'data/training/training_history.json'
THRESHOLDS = {'confidence': .24, 'margin': .045, 'knownRatio': .2}
PARAMETERS = {'alpha': .25, 'ngram_range': [1, 2], 'sublinear_tf': True,
              'norm': 'l2', 'smooth_idf': True}


def reference_source():
    """Read the single official catalog and the imported base snapshot only."""
    history = json.loads(CATALOG.read_text(encoding='utf-8-sig'))
    base_id = history['references']['base_id']
    folder = CATALOG.parent / 'runs' / base_id
    snapshot_path = folder / 'snapshot.json'
    snapshot = json.loads(snapshot_path.read_text(encoding='utf-8-sig'))
    return {'labels': history['labels'], 'examples': snapshot['training_examples'],
            'curve': history['reference_curve'], 'base_id': base_id,
            'stages': history['references']['stages'],
            'base_model_path': folder / 'model.json', 'base_dataset_path': snapshot_path,
            'benchmark_path': folder / 'benchmark.json', 'history_path': CATALOG}


def make_pipeline(classifier=None):
    return Pipeline([
        ('tfidf', TfidfVectorizer(tokenizer=tokenize, token_pattern=None, lowercase=False,
                                ngram_range=(1, 2), sublinear_tf=True, norm='l2', smooth_idf=True)),
        ('classifier', classifier if classifier is not None else MultinomialNB(alpha=.25)),
    ])


def predict(pipeline, text):
    probabilities = pipeline.predict_proba([text])[0]
    classes = pipeline.named_steps['classifier'].classes_
    ranking = sorted(range(len(classes)), key=lambda i: (-probabilities[i], str(classes[i])))
    tokens = tokenize(text)
    vocabulary = pipeline.named_steps['tfidf'].vocabulary_
    known_ratio = sum(token in vocabulary for token in tokens) / len(tokens) if tokens else 0
    confidence = float(probabilities[ranking[0]])
    margin = float(probabilities[ranking[0]] - probabilities[ranking[1]])
    accepted = bool(tokens and confidence >= THRESHOLDS['confidence'] and margin >= THRESHOLDS['margin'] and known_ratio >= THRESHOLDS['knownRatio'])
    return {'intent': str(classes[ranking[0]]), 'confidence': confidence, 'margin': margin,
            'knownRatio': known_ratio, 'accepted': accepted, 'tokens': tokens,
            'probabilities': probabilities.tolist()}


def read_evaluation(training):
    evaluation = json.loads(reference_source()['benchmark_path'].read_text(encoding='utf-8-sig'))
    if len(evaluation) < 50 or {row['intent'] for row in evaluation} != {row['intent'] for row in training}:
        raise ValueError('El benchmark debe tener al menos 50 consultas y las mismas categorías.')
    keys = {' '.join(tokenize(row['text'])) for row in training}
    if any(' '.join(tokenize(row['text'])) in keys for row in evaluation):
        raise ValueError('Una consulta del benchmark aparece en el entrenamiento.')
    return evaluation


def metric_bundle(expected, predicted, labels):
    precision, recall, f1, _ = precision_recall_fscore_support(expected, predicted, average='macro', zero_division=0)
    return {'accuracy': float(accuracy_score(expected, predicted)), 'precision_macro': float(precision),
            'recall_macro': float(recall), 'f1_macro': float(f1),
            'confusion_matrix': confusion_matrix(expected, predicted, labels=labels).tolist(),
            'per_class': classification_report(expected, predicted, labels=labels, output_dict=True, zero_division=0)}


def evaluate(pipeline, evaluation):
    predictions = []
    for row in evaluation:
        result = predict(pipeline, row['text'])
        predictions.append({'text': row['text'], 'expected': row['intent'], 'predicted': result['intent'],
                            'correct': result['intent'] == row['intent'], 'accepted': result['accepted'], 'confidence': result['confidence']})
    labels = sorted(pipeline.named_steps['classifier'].classes_.tolist())
    return {**metric_bundle([p['expected'] for p in predictions], [p['predicted'] for p in predictions], labels),
            'correct': sum(p['correct'] for p in predictions), 'total': len(predictions),
            'accepted': sum(p['accepted'] for p in predictions), 'predictions': predictions}


def explain_error(text, expected, predicted):
    reasons = {
        'pantalla': 'La ausencia de imagen comparte vocabulario con encendido; conviene distinguir señales de vida y salida de video.',
        'encendido': 'Una paráfrasis de falta de arranque puede confundirse con síntomas de carga o pantalla.',
        'software': 'Los bloqueos y errores de aplicaciones comparten palabras con rendimiento y arranque.',
        'rendimiento': 'La lentitud se expresa con metáforas y efectos que también aparecen en software o almacenamiento.',
        'almacenamiento': 'El espacio y la detección de unidades comparten palabras con instalación y rendimiento.',
        'presupuesto': 'Una solicitud de precio puede incluir el síntoma técnico; la acción comercial debe dominar la etiqueta.',
        'contacto': 'Los canales, citas y horarios tienen vocabulario heterogéneo y pueden compartir peticiones de presupuesto.',
        'ayuda': 'Las peticiones generales y la cortesía comparten palabras; la intención pragmática depende de la frase completa.',
        'despedida': 'Un cierre indirecto sin fórmulas habituales puede carecer de las señales léxicas aprendidas.',
        'carga': 'La dependencia del cable puede expresarse sin mencionar batería o cargador.',
        'temperatura': 'La causa térmica puede describirse con metáforas y mezclarse con efectos de lentitud.',
        'sonido': 'Expresiones de oír o hablar pueden quedar fuera del vocabulario de entrenamiento.',
        'conexion': 'Una comparación entre dispositivos requiere interpretar que navegar se refiere a acceso a red.',
        'controles': 'Los periféricos de entrada abarcan palabras variadas; una referencia indirecta al cursor puede confundirse.',
        'liquidos': 'Una bebida o situación nueva puede no compartir agua, humedad o derrame con el corpus.',
        'saludo': 'Una fórmula coloquial no siempre comparte los términos más frecuentes de entrenamiento.',
    }
    return reasons.get(expected, 'La representación léxica no resuelve por sí sola mensajes ambiguos.') + f' Resultado observado: {predicted}; etiqueta esperada: {expected}.'
