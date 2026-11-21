"""Simulación reproducible de quince días; no modifica el modelo original.

Ejecutar ``python -m src.simulation`` desde la raíz. Las frases y el protocolo
se fijan antes de abrir la evaluación independiente. No hay ajuste para obtener
un porcentaje concreto ni errores añadidos durante la inferencia.
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
from uuid import uuid4

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import accuracy_score, precision_score
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline

from src.preprocessing import LEMMA_MAP, STOPWORDS, tokenize
from scripts.team_store import key as example_key


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/simulation.json"
EVALUATION = ROOT / "data/test.csv"
EXPORT = ROOT / "web/simulation"
THRESHOLDS = {"confidence": 0.24, "margin": 0.045, "knownRatio": 0.2}
PARAMETERS = {"alpha": 0.25, "ngram_range": [1, 2], "sublinear_tf": True,
              "norm": "l2", "smooth_idf": True}


def write_json(path: Path, value, *, compact=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False,
                                        indent=None if compact else 2,
                                        separators=(",", ":") if compact else None) + "\n",
                             encoding="utf-8")
        # Reemplazo en el mismo directorio: un lector ve el archivo anterior o
        # el nuevo completo, sin observar una escritura parcial.
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def file_hash(path: Path):
    return sha256(path.read_bytes()).hexdigest()


def read_source():
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    if source.get("simulated") is not True or source.get("format_version") != 1:
        raise ValueError("La fuente debe identificar explícitamente su procedencia simulada.")
    days = source["days"]
    if [day["day"] for day in days] != list(range(1, 16)):
        raise ValueError("Se requieren exactamente quince días relativos, del 1 al 15.")
    labels = set(source["labels"])
    training_ids = {p["id"] for p in source["participants"] if p["role"] == "training"}
    testing_ids = {p["id"] for p in source["participants"] if p["role"] == "testing"}
    if training_ids != {"alumno-a", "alumno-b"} or testing_ids != {"prueba-c", "prueba-d"}:
        raise ValueError("Se requieren dos participantes ficticios por cada rol.")
    seen_ids, seen_training = set(), {}
    for day in days:
        if day.get('timestamp_kind') != 'simulated' or not isinstance(day.get('date'), str):
            raise ValueError('Cada día inicial debe identificar su fecha de escenario simulado.')
        for example in day["examples"]:
            if example.get('timestamp_kind') != 'simulated' or example.get('timezone') != 'America/Mexico_City':
                raise ValueError('Cada ejemplo inicial debe conservar la procedencia de su horario simulado.')
            datetime.fromisoformat(example['created_at'])
            if example["author"] not in training_ids or example["intent"] not in labels:
                raise ValueError("Autor o categoría de entrenamiento desconocidos.")
            if example["id"] in seen_ids or not tokenize(example["text"]):
                raise ValueError("Identificador repetido o ejemplo sin palabras útiles.")
            seen_ids.add(example["id"])
            key = " ".join(tokenize(example["text"]))
            if key in seen_training:
                raise ValueError(f"Ejemplo repetido tras normalizar: {example['text']}")
            seen_training[key] = example["intent"]
        for query in day["queries"]:
            if query.get('timestamp_kind') != 'simulated' or query.get('timezone') != 'America/Mexico_City':
                raise ValueError('Cada consulta inicial debe conservar la procedencia de su horario simulado.')
            datetime.fromisoformat(query['created_at'])
            if query["author"] not in testing_ids or query["expected"] not in labels:
                raise ValueError("Autor o categoría de consulta desconocidos.")
            if query["id"] in seen_ids:
                raise ValueError("Identificador de consulta repetido.")
            seen_ids.add(query["id"])
    if set(e["intent"] for e in days[0]["examples"]) != labels:
        raise ValueError("El primer día debe contener todas las categorías.")
    return source


def make_pipeline():
    return Pipeline([
        ("tfidf", TfidfVectorizer(tokenizer=tokenize, token_pattern=None,
                                 lowercase=False, ngram_range=(1, 2),
                                 sublinear_tf=True, norm="l2", smooth_idf=True)),
        ("classifier", MultinomialNB(alpha=PARAMETERS["alpha"])),
    ])


def fit(examples):
    return make_pipeline().fit([e["text"] for e in examples], [e["intent"] for e in examples])


def export_model(pipeline, total_examples, *, day=None, simulated=True):
    vectorizer = pipeline.named_steps["tfidf"]
    classifier = pipeline.named_steps["classifier"]
    return {
        "format_version": 1, "model_type": "naive_bayes",
        "classes": classifier.classes_.tolist(),
        "features": vectorizer.get_feature_names_out().tolist(),
        "idf": vectorizer.idf_.tolist(),
        "weights": classifier.feature_log_prob_.tolist(),
        "intercept": classifier.class_log_prior_.tolist(),
        "preprocessing": {"stopwords": STOPWORDS, "lemma_map": LEMMA_MAP,
                          "ngram_range": [1, 2], "sublinear_tf": True, "norm": "l2",
                          "unicode": "NFD", "token_pattern": "[a-z0-9]+"},
        "thresholds": THRESHOLDS, "trained_examples": total_examples,
        "simulated": simulated, "simulation_day": day,
        "note": "Clasifica frases; la confianza no es precisión ni certeza de diagnóstico."
    }


def predict(pipeline, text):
    probabilities = pipeline.predict_proba([text])[0]
    classes = pipeline.named_steps["classifier"].classes_
    # Mismo desempate por categoría que web/ml.js.
    ranking = sorted(range(len(classes)), key=lambda i: (-probabilities[i], str(classes[i])))
    tokens = tokenize(text)
    vocabulary = pipeline.named_steps["tfidf"].vocabulary_
    known_ratio = sum(t in vocabulary for t in tokens) / len(tokens) if tokens else 0
    confidence = float(probabilities[ranking[0]])
    margin = float(probabilities[ranking[0]] - probabilities[ranking[1]])
    accepted = bool(tokens and confidence >= THRESHOLDS["confidence"]
                    and margin >= THRESHOLDS["margin"] and known_ratio >= THRESHOLDS["knownRatio"])
    return {"intent": str(classes[ranking[0]]), "confidence": confidence,
            "margin": margin, "knownRatio": known_ratio, "accepted": accepted,
            "tokens": tokens, "probabilities": probabilities.tolist()}


def read_evaluation(training):
    with EVALUATION.open(encoding="utf-8", newline="") as stream:
        evaluation = list(csv.DictReader(stream))
    if len(evaluation) != 80 or set(row["intent"] for row in evaluation) != set(e["intent"] for e in training):
        raise ValueError("La evaluación fija debe contener 80 consultas y las mismas categorías.")
    keys = {" ".join(tokenize(e["text"])) for e in training}
    for row in evaluation:
        if " ".join(tokenize(row["text"])) in keys:
            raise ValueError(f"La prueba independiente aparece en entrenamiento: {row['text']}")
    return evaluation


def evaluate(pipeline, evaluation):
    predictions = []
    for row in evaluation:
        result = predict(pipeline, row["text"])
        predictions.append({"text": row["text"], "expected": row["intent"],
                            "predicted": result["intent"],
                            "correct": result["intent"] == row["intent"],
                            "accepted": result["accepted"], "confidence": result["confidence"]})
    expected = [p["expected"] for p in predictions]
    predicted = [p["predicted"] for p in predictions]
    return {
        "accuracy": float(accuracy_score(expected, predicted)),
        "precision_macro": float(precision_score(expected, predicted, average="macro", zero_division=0)),
        "correct": sum(p["correct"] for p in predictions), "total": len(predictions),
        "accepted": sum(p["accepted"] for p in predictions), "predictions": predictions,
    }


def run():
    source = read_source()
    protocol = {
        "format_version": 1, "simulated": True, "target_accuracy": 0.85,
        "model": "MultinomialNB", "parameters_fixed_before_evaluation": PARAMETERS,
        "thresholds_fixed_before_evaluation": THRESHOLDS,
        "source_sha256": file_hash(SOURCE), "evaluation_sha256": file_hash(EVALUATION),
        "evaluation_file": "data/test.csv",
        "evaluation_policy": "Prueba fija separada. Se abren sus frases después de entrenar los 15 modelos. No selecciona parámetros, ejemplos, umbrales ni días.",
        "selection_policy": "No hay búsqueda de modelos ni selección por el resultado de prueba.",
        "provenance": source['provenance'],
        "calendar": source['calendar'],
    }
    write_json(ROOT / "reports/simulation-protocol.json", protocol)
    pipelines, cumulative = [], []
    # Entrenar toda la secuencia ANTES de leer frases y etiquetas de prueba.
    for day in source["days"]:
        cumulative.extend(day["examples"])
        pipeline = fit(cumulative)
        pipelines.append(pipeline)
        write_json(EXPORT / f"day-{day['day']:02}.json",
                   export_model(pipeline, len(cumulative), day=day["day"]), compact=True)
    evaluation = read_evaluation(cumulative)
    manifest = {
        "format_version": 1, "simulated": True, "target_accuracy": 0.85,
        "participants": source["participants"], "labels": source["labels"],
        "provenance": protocol["provenance"],
        "calendar": source['calendar'],
        "evaluation": {"total": len(evaluation),
                       "description": "Aciertos de clasificación en 80 consultas sintéticas fijas, separadas del entrenamiento. La precisión macro se informa aparte. Las consultas visibles son prácticas distintas de esta prueba.",
                       "source": "data/test.csv", "sha256": file_hash(EVALUATION)},
        "days": [],
    }
    all_predictions, parity, cumulative_count = [], [], 0
    for day, pipeline in zip(source["days"], pipelines):
        metrics = evaluate(pipeline, evaluation)
        cumulative_count += len(day["examples"])
        queries = []
        for query in day["queries"]:
            result = predict(pipeline, query["text"])
            queries.append({**query, "predicted": result["intent"],
                            "correct": result["intent"] == query["expected"],
                            "accepted": result["accepted"]})
        manifest["days"].append({
            "day": day["day"], "title": day["title"], "note": day["note"],
            **{key: day[key] for key in ('date', 'started_at', 'ended_at', 'timezone', 'timestamp_kind')},
            "added_examples": len(day["examples"]), "total_examples": cumulative_count,
            "model_url": f"./simulation/day-{day['day']:02}.json",
            **{key: metrics[key] for key in ("accuracy", "precision_macro", "correct", "total")},
            "accepted": metrics["accepted"], "examples": day["examples"], "queries": queries,
        })
        all_predictions.append({"day": day["day"], "predictions": metrics["predictions"]})
        parity_texts = [q["text"] for q in day["queries"]] + ["¡MI TELÉFONO NO CARGA!", "hola", "xylophone nebula", "", "¿Y sus PANTALLAS?", "El teléfono se está calentando"]
        for text in parity_texts:
            result = predict(pipeline, text)
            parity.append({"day": day["day"], "text": text, **result})
    write_json(EXPORT / "manifest.json", manifest)
    write_json(ROOT / "reports/simulation-predictions.json", {"simulated": True, "days": all_predictions})
    write_json(ROOT / "reports/simulation-parity.json", parity)
    curve = [{key: day[key] for key in ("day", "total_examples", "accuracy", "precision_macro", "correct", "total", "accepted")} for day in manifest["days"]]
    write_json(ROOT / "reports/simulation-metrics.json", {
        "simulated": True, "target_accuracy": 0.85, "curve": curve,
        "parameters": PARAMETERS, "source_sha256": protocol["source_sha256"],
        "evaluation_sha256": protocol["evaluation_sha256"],
        "limitations": ["Frases y participantes sintéticos, sin validación con usuarios reales.",
                        "El objetivo de 85 % no se fuerza: se publica el resultado observado.",
                        "Acierto de clasificación y confianza son medidas distintas.",
                        "La mejora puede tener retrocesos; no se fabrican aciertos ni fallos.",
                        "Una respuesta orientativa no equivale a diagnosticar o reparar un equipo."]})
    print("Día  Ejemplos  Acierto  Precisión macro  Aceptadas")
    for row in curve:
        print(f"{row['day']:>3}  {row['total_examples']:>8}  {row['accuracy']:>7.1%}  {row['precision_macro']:>15.1%}  {row['accepted']:>5}/{row['total']}")
    return manifest


def run_custom(examples_file: Path, output_dir: Path):
    source = read_source()
    base = [e for day in source["days"] for e in day["examples"]]
    payload = json.loads(examples_file.read_text(encoding="utf-8"))
    extras = payload.get("examples")
    if not isinstance(extras, list) or len(extras) > 500:
        raise ValueError("El archivo debe contener examples, una lista de hasta 500 ejemplos.")
    seen = set()
    for example in extras:
        if not isinstance(example, dict) or not isinstance(example.get("text"), str):
            raise ValueError("Cada ejemplo debe contener texto y categoría.")
        if not 3 <= len(example["text"].strip()) <= 1200 or not tokenize(example["text"]):
            raise ValueError("Cada ejemplo requiere de 3 a 1200 caracteres y palabras útiles.")
        if example.get("intent") not in source["labels"]:
            raise ValueError(f"Categoría desconocida: {example.get('intent')}")
        if not isinstance(example.get("author"), str) or not example["author"].strip():
            raise ValueError("Cada ejemplo debe indicar su autor.")
        if not isinstance(example.get("id"), str) or example["id"] in seen:
            raise ValueError("Cada ejemplo debe tener un identificador de texto único.")
        seen.add(example["id"])
    categories = {}
    for example in base + extras:
        normalized = example_key(example['text'])
        previous = categories.get(normalized)
        if previous is not None and previous != example['intent']:
            raise ValueError(
                f"Revisa la consulta «{example['text']}»: aparece con las categorías "
                f"«{previous}» y «{example['intent']}». Corrige el ejemplo antes de entrenar.")
        categories[normalized] = example['intent']
    pipeline = fit(base + extras)
    evaluation = read_evaluation(base + extras)
    metrics = evaluate(pipeline, evaluation)
    write_json(output_dir / "custom-model.json", export_model(pipeline, len(base) + len(extras), simulated=False), compact=True)
    result = {
        "trained_at": datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
        **{key: metrics[key] for key in ("accuracy", "precision_macro", "correct", "total")},
        "total_examples": len(base) + len(extras), "additional_examples": len(extras),
        "model_url": "./simulation/custom-model.json", "simulated": False,
        "base_simulated": True,
        "evaluation_note": "Prueba sintética fija de 80 consultas. Modelo local reentrenado con base simulada del día 15 y los ejemplos añadidos por ustedes. Este resultado de desarrollo no prueba generalización con clientes reales.",
    }
    write_json(output_dir / "custom-result.json", result)
    # ASCII escapado mantiene JSON válido en consolas Windows con código de
    # página heredado y cuando el servidor captura stdout como UTF-8.
    print(json.dumps(result, ensure_ascii=True))
    return result


def check():
    source = read_source()
    manifest = json.loads((EXPORT / "manifest.json").read_text(encoding="utf-8"))
    protocol = json.loads((ROOT / "reports/simulation-protocol.json").read_text(encoding="utf-8"))
    if protocol["source_sha256"] != file_hash(SOURCE) or protocol["evaluation_sha256"] != file_hash(EVALUATION):
        raise ValueError("Los datos cambiaron desde el entrenamiento. Regenera la simulación.")
    if [day["day"] for day in manifest["days"]] != list(range(1, 16)):
        raise ValueError("El manifiesto debe contener quince días, en orden.")
    cumulative = []
    evaluation = read_evaluation([e for day in source["days"] for e in day["examples"]])
    for day, report in zip(source["days"], manifest["days"]):
        cumulative.extend(day["examples"])
        model = json.loads((EXPORT / f"day-{day['day']:02}.json").read_text(encoding="utf-8"))
        if model["trained_examples"] != len(cumulative) or model["classes"] != sorted(source["labels"]):
            raise ValueError("Conteo o categorías exportados incorrectos.")
        actual = evaluate(fit(cumulative), evaluation)
        for key in ("accuracy", "precision_macro", "correct", "total"):
            if actual[key] != report[key]:
                raise ValueError(f"Métrica no reproducible: día {day['day']}, {key}.")
    print("OK: 15 modelos, datos separados, conteos y métricas reproducibles.")


def main():
    # El servidor y los verificadores capturan estos mensajes como UTF-8.
    # En una terminal interactiva se conserva la codificación de la consola.
    for stream in (sys.stdout, sys.stderr):
        if not stream.isatty() and hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--custom", action="store_true", help="Entrenar día 15 más ejemplos propios, sin regenerar la simulación.")
    parser.add_argument("--examples-file", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--check", action="store_true", help="Validar fuente y reproducibilidad de métricas.")
    args = parser.parse_args()
    if args.custom and args.check:
        parser.error("Usa --custom y --check por separado.")
    try:
        if args.custom:
            data_dir = Path(os.environ.get("YINYAN_DATA_DIR", str(ROOT / "data/local")))
            examples_file = args.examples_file
            if examples_file is None:
                from scripts.team_store import TeamStore
                examples_file = data_dir / 'training-input.json'
                saved = TeamStore(ROOT, data_dir).snapshot()
                write_json(examples_file, {'examples': saved.get('approved_examples', [row for row in saved['examples'] if row.get('review_status') == 'approved'])})
            run_custom(examples_file, args.output_dir or examples_file.parent)
        elif args.check:
            check()
        else:
            run()
    except (ValueError, KeyError, OSError, TypeError) as error:
        print(f"No se pudo preparar la simulación: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
