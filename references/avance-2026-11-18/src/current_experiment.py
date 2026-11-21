"""Evaluate the data used by the current local platform without replacing models.

Run ``python -m src.current_experiment`` from the project root. This module
compares two classifiers on exactly the same training snapshot. The currently
deployed Naive Bayes model and the cross-validation winner are reported as
separate facts; this experiment never deploys a model.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import sklearn
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    ConfusionMatrixDisplay, accuracy_score, classification_report,
    confusion_matrix, precision_recall_fscore_support,
)
from sklearn.model_selection import StratifiedKFold, cross_validate

from scripts.team_store import TeamStore, key as example_key
from src.preprocessing import tokenize
from src.simulation import (
    EVALUATION, PARAMETERS, ROOT, SOURCE, THRESHOLDS, evaluate,
    make_pipeline, predict, read_evaluation, read_source, write_json,
)
from src.train import explain_error


SEED = 42
OUTPUT = ROOT / "reports"
ACTIVE_MODEL = "naive_bayes"


def _digest(value):
    content = json.dumps(value, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":")).encode("utf-8")
    return sha256(content).hexdigest()


def _live_examples():
    """Read existing contribution files without migrations or write effects."""
    runtime = Path(os.environ.get("YINYAN_DATA_DIR", str(ROOT / "data/local")))
    store = TeamStore(ROOT, runtime)
    removed = {record["example_id"] for record in store.records("deletions")}
    return [record for record in store.records("examples")
            if record["id"] not in removed]


def _metrics(expected, predicted, labels):
    precision, recall, f1, _ = precision_recall_fscore_support(
        expected, predicted, labels=labels, average="macro", zero_division=0)
    return {
        "accuracy": float(accuracy_score(expected, predicted)),
        "precision_macro": float(precision), "recall_macro": float(recall),
        "f1_macro": float(f1),
        "confusion_matrix": confusion_matrix(expected, predicted, labels=labels).tolist(),
        "per_class": classification_report(expected, predicted, labels=labels,
                                           output_dict=True, zero_division=0),
        "correct": sum(a == b for a, b in zip(expected, predicted)),
        "total": len(expected),
    }


def _team():
    path = ROOT / "docs/equipo.json"
    return json.loads(path.read_text(encoding="utf-8-sig")) if path.is_file() else {}


def _figures(result):
    for name, metrics in result["models"].items():
        figure, axis = plt.subplots(figsize=(11, 9))
        ConfusionMatrixDisplay(np.asarray(metrics["confusion_matrix"]),
                               display_labels=result["labels"]).plot(
            ax=axis, cmap="Blues", colorbar=False,
            xticks_rotation=65, values_format="d")
        title = "Naive Bayes (modelo activo)" if name == ACTIVE_MODEL else "Regresión logística (comparación)"
        axis.set_title(f"{title}\n{metrics['correct']}/{metrics['total']} aciertos; datos actuales")
        axis.set_xlabel("Intención predicha")
        axis.set_ylabel("Intención real")
        figure.tight_layout()
        figure.savefig(OUTPUT / f"current-confusion-{name}.png", dpi=145)
        plt.close(figure)
    curve = result["curve"]
    figure, axis = plt.subplots(figsize=(9, 4.3))
    axis.plot([row["day"] for row in curve],
              [100 * row["accuracy"] for row in curve], marker="o", color="#315340")
    axis.set(xlabel="Etapa acumulativa", ylabel="Acierto de clasificación (%)",
             title="Quince etapas de entrenamiento de la base inicial",
             xticks=list(range(1, 16)), ylim=(0, 100))
    axis.grid(alpha=.2)
    figure.tight_layout()
    figure.savefig(OUTPUT / "current-learning-curve.png", dpi=145)
    plt.close(figure)


def build_current_experiment(write_outputs=True):
    """Return a reproducible evaluation snapshot; optionally save reports only.

    Five-fold CV uses training data alone. Both classifiers and every baseline
    stage are fitted before this function opens the evaluation CSV. Repeated
    observation of that CSV makes it a development benchmark; a new held-out
    sample is required for a final, previously unseen assessment.
    """
    source = read_source()
    base = [example for day in source["days"] for example in day["examples"]]
    additional = _live_examples()
    training = base + additional
    labels = sorted(source["labels"])
    categories = {}
    for row in training:
        if row.get("intent") not in labels or not isinstance(row.get("text"), str) or not tokenize(row["text"]):
            raise ValueError("Hay un ejemplo sin texto útil o con una categoría desconocida.")
        normalized = example_key(row["text"])
        if normalized in categories and categories[normalized] != row["intent"]:
            raise ValueError(f"El texto {row['text']!r} tiene categorías contradictorias.")
        categories[normalized] = row["intent"]
    per_intent = dict(sorted(Counter(row["intent"] for row in training).items()))
    if min(per_intent.values()) < 5:
        raise ValueError("La comparación estratificada necesita cinco ejemplos por intención.")
    pipelines = {
        ACTIVE_MODEL: make_pipeline(),
        "logistic_regression": make_pipeline().set_params(
            classifier=LogisticRegression(C=8.0, max_iter=2000, random_state=SEED)),
    }
    texts = [row["text"] for row in training]
    targets = [row["intent"] for row in training]
    folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    cv = {}
    for name, pipeline in pipelines.items():
        scores = cross_validate(pipeline, texts, targets, cv=folds, n_jobs=1,
                                scoring={"f1_macro": "f1_macro", "accuracy": "accuracy"})
        cv[name] = {
            "f1_macro_mean": float(scores["test_f1_macro"].mean()),
            "f1_macro_std": float(scores["test_f1_macro"].std()),
            "accuracy_mean": float(scores["test_accuracy"].mean()),
            "fold_f1_macro": scores["test_f1_macro"].tolist(),
            "fold_accuracy": scores["test_accuracy"].tolist(),
        }
        pipeline.fit(texts, targets)
    cv_winner = max(pipelines, key=lambda name: (cv[name]["f1_macro_mean"], name == "logistic_regression"))

    # Recompute the baseline curve; loading a previously generated chart alone
    # would not establish that it matches the supplied data and parameters.
    stage_pipelines, cumulative = [], []
    for stage in source["days"]:
        cumulative.extend(stage["examples"])
        stage_pipelines.append(make_pipeline().fit(
            [row["text"] for row in cumulative], [row["intent"] for row in cumulative]))

    evaluation = read_evaluation(training)
    expected = [row["intent"] for row in evaluation]
    models, predictions, errors = {}, {}, []
    for name, pipeline in pipelines.items():
        predicted = pipeline.predict([row["text"] for row in evaluation]).tolist()
        models[name] = _metrics(expected, predicted, labels)
        predictions[name] = []
        for row, label in zip(evaluation, predicted):
            prediction = {"text": row["text"], "expected": row["intent"],
                          "predicted": label, "correct": row["intent"] == label}
            predictions[name].append(prediction)
            if not prediction["correct"]:
                errors.append({"model": name, "text": row["text"],
                               "expected": row["intent"], "predicted": label,
                               "interpretation": explain_error(row["text"], row["intent"], label)})
    accepted = [predict(pipelines[ACTIVE_MODEL], row["text"]) for row in evaluation]
    accepted_count = sum(row["accepted"] for row in accepted)
    correct_accepted = sum(prediction["accepted"] and prediction["intent"] == target
                           for prediction, target in zip(accepted, expected))
    acceptance = {
        "accepted": accepted_count, "total": len(evaluation),
        "correct_accepted": correct_accepted,
        "coverage": accepted_count / len(evaluation),
        "accuracy_among_accepted": correct_accepted / accepted_count if accepted_count else None,
        "thresholds": THRESHOLDS,
        "note": "El acierto global usa las 80 categorías más probables, incluso cuando el bot pide aclaración. La cobertura indica cuántas consultas acepta sin ese rechazo estadístico.",
    }
    curve = []
    count = 0
    for stage, pipeline in zip(source["days"], stage_pipelines):
        count += len(stage["examples"])
        observed = evaluate(pipeline, evaluation)
        curve.append({"day": stage["day"], "total_examples": count,
                      **{key: observed[key] for key in ("accuracy", "precision_macro", "correct", "total", "accepted")}})
    prior = json.loads((ROOT / "reports/simulation-metrics.json").read_text(encoding="utf-8"))
    if curve != prior["curve"]:
        raise ValueError("La curva recalculada difiere de los resultados de la base inicial. Revisa el cambio antes de publicar documentos.")
    if not additional and models[ACTIVE_MODEL]["correct"] != curve[-1]["correct"]:
        raise ValueError("El resultado actual no coincide con la última etapa de su base.")
    per_intent_missing = {label: max(0, 20 - per_intent[label]) for label in labels}
    result = {
        "format_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "active_model": ACTIVE_MODEL, "cv_winner": cv_winner,
        "active_matches_cv_winner": cv_winner == ACTIVE_MODEL,
        "counts": {"base": len(base), "additional": len(additional), "total": len(training),
                   "test": len(evaluation), "intents": len(labels), "per_intent": per_intent},
        "labels": labels, "cv": cv, "models": models, "errors": errors,
        "acceptance": acceptance, "curve": curve, "curve_verified": True,
        "predictions": predictions, "team": _team(),
        "requirements": {"minimum_training": 200, "minimum_intents": 10,
                         "minimum_per_intent": 20, "minimum_test": 50,
                         "training_total_met": len(training) >= 200,
                         "intents_met": len(labels) >= 10,
                         "per_intent_met": all(value >= 20 for value in per_intent.values()),
                         "test_total_met": len(evaluation) >= 50,
                         "per_intent_missing": per_intent_missing,
                         "missing_examples_total": sum(per_intent_missing.values())},
        "protocol": {
            "seed": SEED, "cv": "StratifiedKFold(n_splits=5, shuffle=True, random_state=42)",
            "selection": "Mayor F1 macro medio de validación cruzada; empate: regresión logística.",
            "deployment": "Se conserva Naive Bayes como modelo activo. El ganador de CV se informa por separado, sin reemplazar artefactos de la aplicación.",
            "parameters": {ACTIVE_MODEL: PARAMETERS,
                           "logistic_regression": {"C": 8.0, "max_iter": 2000, "random_state": SEED}},
            "representation": "TF-IDF de unigramas y bigramas, frecuencia sublineal y normalización L2; mismo tokenizador, stopwords y lematización ligera que la aplicación.",
            "fit_order": "CV y ajuste de ambos modelos y las quince etapas antes de leer la evaluación.",
            "evaluation_policy": "Benchmark de desarrollo fijo de 80 consultas. No se seleccionan modelos ni parámetros con su resultado. Por su uso repetido requiere una nueva prueba inédita para la evaluación final.",
            "matrix_order": "Filas: categoría real; columnas: predicción; orden de labels.",
        },
        "provenance": {
            "base": "Base de 240 ejemplos preparados para quince etapas acumulativas. No representa quince jornadas reales ni demuestra aportaciones históricas de personas.",
            "additional": "Aportaciones vivas registradas en data/team, respetando sus autores y fechas originales.",
            "evaluation": "80 consultas sintéticas de data/test.csv; sin coincidencias tras tokenización con el entrenamiento.",
            "timestamps": "generated_at es la hora real de este cálculo; no modifica las fechas de datos ni de modelos anteriores.",
        },
        "snapshot_data": {"base_examples": base, "additional_examples": additional,
                          "training_examples": training, "evaluation": evaluation},
        "hashes": {"base_file_sha256": sha256(SOURCE.read_bytes()).hexdigest(),
                   "evaluation_file_sha256": sha256(EVALUATION.read_bytes()).hexdigest(),
                   "additional_examples_sha256": _digest(additional),
                   "training_snapshot_sha256": _digest(training),
                   "preprocessing_sha256": sha256((ROOT / "src/preprocessing.py").read_bytes()).hexdigest()},
        "versions": {"scikit_learn": sklearn.__version__, "numpy": np.__version__},
        "limitations": [
            "Datos pequeños y mayormente sintéticos; no equivalen a validación con usuarios reales.",
            "La confianza del clasificador, el acierto global y la cobertura son medidas distintas.",
            "La base inicial tiene 15 ejemplos por intención; el mínimo de la consigna es 20.",
            "La clasificación orienta respuestas y preguntas; no confirma una avería física.",
            "Los cuatro roles del equipo describen responsabilidades; los nombres y aportaciones deben corresponder a la participación real.",
        ],
    }
    if write_outputs:
        OUTPUT.mkdir(parents=True, exist_ok=True)
        _figures(result)
        write_json(OUTPUT / "current-experiment.json", result)
    return result


def main():
    result = build_current_experiment()
    print(json.dumps({"generated_at": result["generated_at"], "counts": result["counts"],
                      "active_model": result["active_model"], "cv_winner": result["cv_winner"],
                      "active_accuracy": result["models"][ACTIVE_MODEL]["accuracy"],
                      "accepted": result["acceptance"]["accepted"],
                      "missing_examples_total": result["requirements"]["missing_examples_total"]},
                     ensure_ascii=True))


if __name__ == "__main__":
    main()
