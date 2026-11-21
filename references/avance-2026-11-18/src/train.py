"""Ejecutar desde la raíz: python -m src.train.

Selección exclusivamente por CV de desarrollo. La prueba independiente y el
reto se leen después de seleccionar y ajustar ambos modelos a entrenamiento.
No hay búsqueda de parámetros sobre prueba ni ajuste de umbrales con ella.
"""
from collections import Counter
from hashlib import sha256
from pathlib import Path
import csv
import json
import platform
import time

import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import sklearn
from sklearn.base import clone
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, precision_recall_fscore_support, ConfusionMatrixDisplay
from sklearn.model_selection import StratifiedKFold, cross_validate
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline
from src.preprocessing import tokenize, normalize, LEMMA_MAP, STOPWORDS

ROOT = Path(__file__).resolve().parents[1]
SEED = 42
THRESHOLDS = {"confidence": 0.24, "margin": 0.045, "knownRatio": 0.2}

def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")

def prepare_data():
    corpus = json.loads((ROOT / "data/corpus.json").read_text(encoding="utf-8"))
    for split in ("train", "test"):
        dest = ROOT / f"data/{split}.csv"
        rows = [{"text": text, "intent": label} for label, values in corpus.items() for text in values[split]]
        with dest.open("w", encoding="utf-8", newline="") as file:
            writer = csv.DictWriter(file, fieldnames=["text", "intent"])
            writer.writeheader()
            writer.writerows(rows)
    return corpus

def digest(path):
    return sha256(path.read_bytes()).hexdigest()

def validate_data(train, test, challenge):
    assert len(train) >= 200 and len(test) >= 50
    assert train.intent.nunique() >= 10
    assert train.groupby("intent").size().min() >= 20
    # Duplicación exacta y tras normalización léxica: dentro y entre particiones.
    seen = {}
    for split, frame in (("train", train), ("test", test), ("challenge", challenge)):
        for row in frame.itertuples():
            key = " ".join(tokenize(row.text))
            if key in seen:
                raise ValueError(f"Duplicado normalizado: {split}: {row.text!r}; previo={seen[key]}")
            seen[key] = (split, row.text)
    assert set(train.intent) == set(test.intent)

def make_pipeline(classifier):
    return Pipeline([
        ("tfidf", TfidfVectorizer(tokenizer=tokenize, token_pattern=None, lowercase=False,
                                 ngram_range=(1, 2), sublinear_tf=True, norm="l2", smooth_idf=True)),
        ("classifier", classifier)
    ])

def metric_bundle(y, pred, labels):
    precision, recall, f1, _ = precision_recall_fscore_support(y, pred, average="macro", zero_division=0)
    return {"accuracy": float(accuracy_score(y, pred)), "precision_macro": float(precision),
            "recall_macro": float(recall), "f1_macro": float(f1),
            "confusion_matrix": confusion_matrix(y, pred, labels=labels).tolist(),
            "per_class": classification_report(y, pred, labels=labels, output_dict=True, zero_division=0)}

def explain_error(text, expected, predicted):
    reasons = {
        "pantalla": "La ausencia de imagen comparte vocabulario con encendido; conviene distinguir señales de vida y salida de video.",
        "encendido": "Una paráfrasis de falta de arranque puede confundirse con síntomas de carga o pantalla.",
        "software": "Los bloqueos y errores de aplicaciones comparten palabras con rendimiento y arranque.",
        "rendimiento": "La lentitud se expresa con metáforas y efectos que también aparecen en software o almacenamiento.",
        "almacenamiento": "El espacio y la detección de unidades son distintos, pero aparecen junto con palabras comunes a instalación y rendimiento.",
        "presupuesto": "Una solicitud de precio puede incluir el síntoma técnico; la acción comercial debe dominar la etiqueta.",
        "contacto": "Los canales, citas y horarios tienen vocabulario heterogéneo y pueden compartir una petición de presupuesto.",
        "ayuda": "Las peticiones generales y la cortesía comparten palabras; la intención pragmática depende de la frase completa.",
        "despedida": "Un cierre indirecto sin fórmulas habituales puede carecer de las señales léxicas aprendidas.",
        "carga": "La dependencia del cable puede expresarse sin mencionar batería o cargador.",
        "temperatura": "La causa térmica puede describirse mediante metáforas y mezclarse con efectos de lentitud.",
        "sonido": "Expresiones de oír o hablar pueden quedar fuera del vocabulario de entrenamiento.",
        "conexion": "Una comparación entre dispositivos requiere interpretar que navegar se refiere a acceso a red.",
        "controles": "Los periféricos de entrada abarcan palabras variadas; una referencia indirecta al cursor puede confundirse.",
        "liquidos": "Una bebida o situación nueva puede no compartir los términos agua, humedad o derrame del corpus.",
        "saludo": "Una fórmula de saludo coloquial no siempre comparte los términos más frecuentes del entrenamiento."
    }
    return reasons.get(expected, "La representación léxica no entiende causalidad ni resuelve por sí sola mensajes ambiguos.") + f" Resultado observado: {predicted}; etiqueta esperada: {expected}."

def export_browser(pipeline, model_name, labels):
    vectorizer = pipeline.named_steps["tfidf"]
    classifier = pipeline.named_steps["classifier"]
    is_logistic = model_name == "logistic_regression"
    artifact = {
        "format_version": 1, "model_type": model_name, "classes": classifier.classes_.tolist(),
        "features": vectorizer.get_feature_names_out().tolist(), "idf": vectorizer.idf_.tolist(),
        "weights": (classifier.coef_ if is_logistic else classifier.feature_log_prob_).tolist(),
        "intercept": (classifier.intercept_ if is_logistic else classifier.class_log_prior_).tolist(),
        "preprocessing": {"stopwords": STOPWORDS, "lemma_map": LEMMA_MAP, "ngram_range": [1, 2], "sublinear_tf": True, "norm": "l2", "unicode": "NFD", "token_pattern": "[a-z0-9]+"},
        "thresholds": THRESHOLDS, "trained_examples": 384, "seed": SEED,
        "note": "Probabilidades de un clasificador léxico; no equivalen a certeza de diagnóstico ni están calibradas clínicamente."
    }
    write_json(ROOT / "web/model.json", artifact)
    # Compacto para despliegue, aún plenamente legible por JSON.
    (ROOT / "web/model.json").write_text(json.dumps(artifact, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return artifact

def run():
    prepare_data()
    train = pd.read_csv(ROOT / "data/train.csv")
    # Congelar el protocolo y los hashes ANTES de entrenar: la prueba no elige
    # parámetros, representación, modelo o política de rechazo.
    hashes = {name: digest(ROOT / f"data/{name}.csv") for name in ("train", "test", "challenge")}
    protocol = {"seed": SEED, "cv": "StratifiedKFold(n_splits=5, shuffle=True, random_state=42)",
                "selection": "maximum mean development cross-validation macro F1; tie -> logistic_regression",
                "thresholds_fixed_before_test": THRESHOLDS, "data_hashes": hashes,
                "models": {"logistic_regression": {"C": 8.0, "max_iter": 2000}, "naive_bayes": {"alpha": 0.25}}}
    write_json(ROOT / "reports/protocol.json", protocol)
    pipelines = {
        "logistic_regression": make_pipeline(LogisticRegression(C=8.0, max_iter=2000, random_state=SEED)),
        "naive_bayes": make_pipeline(MultinomialNB(alpha=0.25))
    }
    labels = sorted(train.intent.unique())
    folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    cv = {}
    for name, pipeline in pipelines.items():
        values = cross_validate(pipeline, train.text, train.intent, cv=folds,
                                scoring={"f1_macro": "f1_macro", "accuracy": "accuracy"}, n_jobs=1)
        cv[name] = {"f1_macro_mean": float(values["test_f1_macro"].mean()),
                    "f1_macro_std": float(values["test_f1_macro"].std()),
                    "accuracy_mean": float(values["test_accuracy"].mean()),
                    "folds": values["test_f1_macro"].tolist()}
    selected = max(pipelines, key=lambda name: cv[name]["f1_macro_mean"])
    for name, pipeline in pipelines.items():
        pipeline.fit(train.text, train.intent)
        joblib.dump(pipeline, ROOT / f"models/{name}.joblib")
    joblib.dump(pipelines[selected], ROOT / "models/selected_pipeline.joblib")
    export_browser(pipelines[selected], selected, labels)
    # Evaluación final tras selección. Cualquier cambio posterior exige una
    # nueva partición verdaderamente independiente para afirmar generalización.
    test = pd.read_csv(ROOT / "data/test.csv")
    challenge = pd.read_csv(ROOT / "data/challenge.csv")
    validate_data(train, test, challenge)
    models, challenges, errors = {}, {}, []
    for name, pipeline in pipelines.items():
        for split, frame in (("test", test), ("challenge", challenge)):
            pred = pipeline.predict(frame.text)
            probabilities = pipeline.predict_proba(frame.text)
            bundle = metric_bundle(frame.intent, pred, labels)
            (models if split == "test" else challenges)[name] = bundle
            output = frame.copy()
            output["predicted"] = pred
            output["confidence"] = probabilities.max(axis=1)
            output["correct"] = frame.intent.to_numpy() == pred
            output.to_csv(ROOT / f"reports/predictions_{name}_{split}.csv", index=False)
            for row, predicted in zip(frame.itertuples(), pred):
                if row.intent != predicted:
                    errors.append({"text": row.text, "expected": row.intent, "predicted": str(predicted), "model": name, "split": split,
                                   "interpretation": explain_error(row.text, row.intent, predicted)})
        fig, ax = plt.subplots(figsize=(11.5, 10))
        ConfusionMatrixDisplay(np.array(models[name]["confusion_matrix"]), display_labels=labels).plot(ax=ax, cmap="Blues", colorbar=False, xticks_rotation=65, values_format="d")
        ax.set_title(f"Prueba independiente · {name}\n80 mensajes, sin selección con prueba")
        ax.set_xlabel("Intención predicha"); ax.set_ylabel("Intención real")
        fig.tight_layout()
        fig.savefig(ROOT / f"reports/confusion_{name}.png", dpi=150)
        plt.close(fig)
    metrics = {
        "selected_model": selected,
        "selection_reason": f"Mayor F1 macro medio de validación cruzada estratificada sobre entrenamiento: {cv[selected]['f1_macro_mean']:.4f}. La prueba final no participa en la decisión.",
        "counts": {"train": len(train), "test": len(test), "challenge": len(challenge), "intents": len(labels)},
        "labels": labels, "cv": cv, "models": models, "challenge_models": challenges,
        "errors": errors, "thresholds": THRESHOLDS, "data_hashes": hashes,
        "versions": {"python": platform.python_version(), "scikit-learn": sklearn.__version__, "numpy": np.__version__, "pandas": pd.__version__, "matplotlib": matplotlib.__version__, "joblib": joblib.__version__},
        "seed": SEED, "limitations": ["Corpus sintético pequeño y no validado con clientes reales.", "Reto deliberadamente ambiguo: su etiqueta refleja una convención de intención dominante.", "Probabilidades sin calibración externa; rechazo heurístico con umbrales fijados antes de prueba.", "Lematización ligera por diccionario: no es un analizador morfológico completo.", "El modelo clasifica solicitudes; no identifica componentes dañados ni garantiza una reparación."]
    }
    write_json(ROOT / "reports/metrics.json", metrics)
    table = pd.DataFrame({name: {k: result[k] for k in ("accuracy", "precision_macro", "recall_macro", "f1_macro")} for name, result in models.items()}).T
    fig, ax = plt.subplots(figsize=(8.8, 4.5))
    table.plot.bar(ax=ax, ylim=(0, 1.05), color=["#8265ed", "#47bdb0", "#f0b960", "#5b85c9"], rot=0)
    ax.set_title("Comparación final · prueba independiente"); ax.set_ylabel("Puntuación"); ax.legend(loc="lower right", fontsize=8)
    fig.tight_layout(); fig.savefig(ROOT / "reports/comparison.png", dpi=160); plt.close(fig)
    # Referencia de paridad para JS: inferencia completa y características.
    parity_texts = list(test.text) + ["¡MI TELÉFONO NO CARGA!", "hola", "xylophone nebula", "", "¿Y sus PANTALLAS?", "El teléfono se está calentando"]
    selected_pipeline = pipelines[selected]
    write_json(ROOT / "reports/parity_reference.json", [{"text": t, "tokens": tokenize(t), "intent": str(selected_pipeline.predict([t])[0]), "probabilities": selected_pipeline.predict_proba([t])[0].tolist()} for t in parity_texts])
    print(table.round(4).to_string())
    print(f"Seleccionado por CV: {selected}. Casos erróneos registrados: {len(errors)}.")
    return metrics

if __name__ == "__main__":
    run()
