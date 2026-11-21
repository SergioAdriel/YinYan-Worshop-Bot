"""Genera y ejecuta el notebook del modelo que utiliza la aplicación actual.

No reconstruye el corpus antiguo ni sustituye el modelo de la página.
"""
from pathlib import Path
import asyncio
import json
import os
import sys

import nbformat
from nbclient import NotebookClient
from nbformat.v4 import new_notebook, new_markdown_cell as md, new_code_cell as code

ROOT = Path(__file__).resolve().parents[1]


def build(version_id=None):
    notebook = new_notebook(cells=[
        md("""# PROTOTIPO FUNCIONAL — AVANCE AL 18 DE NOVIEMBRE DE 2026

**Proyecto Final I — Chatbot Inteligente mediante Aprendizaje Automático.**
Opción B: soporte técnico informático limitado a computadoras, celulares y
consolas. **Desarrollador principal: Sergio Adriel Muñoz Camarena.**
Corte de documentación: **18 de noviembre de 2026**; cada ejecución imprime su
propia fecha y la instantánea de datos utilizada.

**Entrega final prevista: 4 de diciembre de 2026.** Este documento presenta un
avance funcional que permite continuar incorporando datos y entrenamientos.

El equipo está integrado por Erick Mendoza Mendoza y Daniel Gibran Luciano
Tellez (construcción y revisión del dataset), Sergio Adriel Muñoz Camarena
(programación, gestor, interfaz e integración) y Raynier Jetsahe Torres Flores
(integración, entrenamiento, evaluación y verificación). La distribución de
responsabilidades corresponde a la indicada por el equipo; las aportaciones y
ejecuciones nuevas conservan su responsable y fecha reales.

La base contiene **240 ejemplos sintéticos, 16 intenciones y 15 ejemplos por
intención**, acumulados en **15 etapas**. Las fechas del escenario son simuladas;
no representan quince días de trabajo real. Los ejemplos revisados de
`data/team/` se agregan con su propia procedencia. El mínimo solicitado de 20
ejemplos por intención **no se cumple con la base sola**: faltan al menos 80
ejemplos pertinentes y diversos, cinco por categoría. No se completa esa
diferencia mediante duplicados.

Se evalúan **Naive Bayes** y **regresión logística**, con los mismos datos y
validación cruzada. Se documenta la versión seleccionada y se identifica su
estado provisional, aprobado o histórico. Las 80 consultas de referencia ya se han usado durante el
desarrollo: esta evaluación es reproducible, **no una nueva prueba final ciega**.
Se requiere otra prueba reservada para afirmar mejoras generalizables después
de los ajustes.

## Ejecutar

Desde la raíz: `python -m src.create_notebook`, o `reproducir-notebook.cmd`.
Python 3.12 y `requirements-lock.txt` identifican el entorno. Usa `notebook.cmd`
para abrirlo; en otra instalación, configura Jupyter con el repositorio completo.
No usa APIs de clasificación, claves privadas ni modelos lingüísticos descargados.
La ejecución escribe los artefactos `reports/current-*` y conserva los datos y
modelos anteriores.
"""),
        code("""from pathlib import Path
from hashlib import sha256
import sys, json, platform
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import sklearn
from IPython.display import display
from IPython import get_ipython
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline
from sklearn.model_selection import StratifiedKFold, cross_validate
from sklearn.metrics import accuracy_score, precision_recall_fscore_support, ConfusionMatrixDisplay

ROOT = next(p for p in [Path.cwd(), *Path.cwd().parents]
            if (p/'data/simulation.json').is_file() and (p/'src/current_experiment.py').is_file())
if str(ROOT) not in sys.path: sys.path.insert(0, str(ROOT))
from src.preprocessing import normalize, tokenize
from src.current_experiment import build_current_experiment
get_ipython().run_line_magic('matplotlib', 'inline')
DOCUMENT_VERSION = None
protected = ['data/simulation.json', 'data/test.csv', 'data/train.csv', 'web/model.json',
             'web/simulation/day-15.json', 'reports/metrics.json']
before_hashes = {name: sha256((ROOT/name).read_bytes()).hexdigest() for name in protected}
team = json.loads((ROOT/'docs/equipo.json').read_text(encoding='utf-8-sig'))
print('Python', platform.python_version(), '| scikit-learn', sklearn.__version__)
print('Proyecto:', ROOT.name)
display(pd.DataFrame(team['roles'])[['nombre', 'funcion', 'alcance']])
"""),
        md("""## 1. Instantánea y protocolo actual

La función siguiente **entrena y calcula** el experimento; no se limita a leer
métricas guardadas. Congela una instantánea de la base y las aportaciones
revisadas, compara dos clasificadores con cinco pliegues y evalúa ambos en las
80 consultas de referencia. Las celdas posteriores muestran las operaciones y
verifican su reproducción.

Cada vectorizador se ajusta solo con el entrenamiento del pliegue. Las etiquetas
de referencia no eligen el ganador de CV ni sustituyen silenciosamente el
clasificador activo de la plataforma.
"""),
        code("""experiment = build_current_experiment(write_outputs=True, version_id=DOCUMENT_VERSION)
snapshot = experiment['snapshot_data']
active_model = experiment['active_model']
train = pd.DataFrame(snapshot['training_examples'])
test = pd.DataFrame(snapshot['evaluation'])
labels = sorted(train.intent.unique())
print('Ejecución:', experiment['generated_at'])
print('Conteos:', experiment['counts'])
print('Modelo activo:', experiment['active_model'], '| ganador de CV:', experiment['cv_winner'])
print('Versión documentada:', experiment.get('version_id', 'base de referencia'))
print('Versión del dataset:', experiment.get('dataset_version', experiment['hashes'].get('training_snapshot_sha256')))
print('Procedencia:', experiment['provenance'])
display(experiment['protocol'])
display(train[['text', 'intent']].head(8))
"""),
        md("""## 2. Exploración y requisito de ejemplos

Los conteos corresponden a la instantánea actual, no al corpus anterior de 384
frases. Los faltantes por intención orientan el trabajo del equipo. Los ejemplos
deben aportar diversidad y categorías correctas. La base propuesta con apoyo
generativo requiere revisión humana; no contiene consultas de clientes reales
ni acredita sesiones históricas de estudiantes.
"""),
        code("""distribution = train.groupby('intent').size().reindex(labels).rename('ejemplos').to_frame()
distribution['faltan_para_20'] = (20 - distribution.ejemplos).clip(lower=0)
display(distribution)
assert len(train) >= 200 and len(labels) >= 10 and len(test) >= 50
print('Mínimo por categoría:', int(distribution.ejemplos.min()))
print('¿Todas tienen al menos 20?:', bool((distribution.ejemplos >= 20).all()))
print('Ejemplos faltantes:', int(distribution.faltan_para_20.sum()))
display(experiment['requirements'])
ax = distribution.ejemplos.plot.bar(figsize=(11, 3.5), color='#315340', title='Datos usados por el modelo actual')
ax.axhline(20, color='#a75a2a', linestyle='--', label='Mínimo solicitado')
ax.set_ylabel('Ejemplos'); ax.legend(); plt.tight_layout(); plt.show()
"""),
        md("""## 3. Preparación del lenguaje natural

Minúsculas, descomposición Unicode NFD y eliminación de diacríticos;
tokenización `[a-z0-9]+`; filtrado de palabras funcionales y lematización ligera
mediante un diccionario explícito. Se conserva **no** para distinguir síntomas.
El diccionario tiene cobertura limitada, no es un analizador completo de español.
El navegador recibe la misma lista y mapa de lemas junto con cada modelo.
"""),
        code("""for text in ['¡MI TELÉFONO NO CARGA!', 'Las pantallas están rotas',
             'La laptop se está calentando', 'Mi computadora no detecta redes']:
    print(text, '\\n  normalizado:', normalize(text), '\\n  tokens:', tokenize(text))
assert 'no' in tokenize('Mi teléfono no carga')
train_keys = train.text.map(lambda value: ' '.join(tokenize(value)))
test_keys = test.text.map(lambda value: ' '.join(tokenize(value)))
print('Duplicados normalizados dentro de entrenamiento:', int(train_keys.duplicated().sum()))
print('Coincidencias normalizadas entrenamiento/referencia:', len(set(train_keys) & set(test_keys)))
assert not (set(train_keys) & set(test_keys)), 'La referencia aparece en entrenamiento'
"""),
        md("""## 4. Representación TF-IDF

Unigramas y bigramas, frecuencia sublineal `1 + ln(tf)`, IDF suavizado y norma
L2. Los bigramas conservan relaciones locales y las palabras conocidas permiten
representar combinaciones nuevas. El modelo no comprende por sí solo causalidad,
metáforas ni términos ausentes del vocabulario.

Esta matriz es exploratoria: cada pipeline de validación crea otro vectorizador.
"""),
        code("""def make_pipeline(classifier):
    return Pipeline([
        ('tfidf', TfidfVectorizer(tokenizer=tokenize, token_pattern=None, lowercase=False,
                                 ngram_range=(1, 2), sublinear_tf=True, norm='l2', smooth_idf=True)),
        ('classifier', classifier),
    ])

exploratory = make_pipeline(MultinomialNB(alpha=0.25)).named_steps['tfidf']
X = exploratory.fit_transform(train.text)
print('Forma:', X.shape, '| densidad:', X.nnz / (X.shape[0] * X.shape[1]))
print('Primeros términos:', exploratory.get_feature_names_out()[:25])
"""),
        md("""## 5. Dos clasificadores y validación comparable

Naive Bayes multinomial (`alpha=0.25`) y regresión logística (`C=8`,
`max_iter=2000`) usan cinco pliegues estratificados, semilla 42 y la misma
representación. No se realizó una búsqueda exhaustiva de parámetros.
La celda vuelve a ejecutar CV explícitamente y verifica el resultado.

El mayor F1 macro medio identifica al ganador. La aplicación mantiene Naive Bayes
para la práctica acumulativa. Si otro modelo gana CV, debe explicarse esa
diferencia de selección e integración; no se afirma que el activo sea óptimo.
"""),
        code("""pipelines = {
    'naive_bayes': make_pipeline(MultinomialNB(alpha=0.25)),
    'logistic_regression': make_pipeline(LogisticRegression(C=8.0, max_iter=2000, random_state=42)),
}
folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
cv_results = {}
for name, pipeline in pipelines.items():
    values = cross_validate(pipeline, train.text, train.intent, cv=folds,
                            scoring={'f1_macro': 'f1_macro', 'accuracy': 'accuracy'}, n_jobs=1)
    cv_results[name] = {'f1_macro_mean': float(values['test_f1_macro'].mean()),
                        'f1_macro_std': float(values['test_f1_macro'].std()),
                        'accuracy_mean': float(values['test_accuracy'].mean())}
    for metric, value in cv_results[name].items():
        assert abs(value - experiment['cv'][name][metric]) < 1e-10
display(pd.DataFrame(cv_results).T)
winner = max(cv_results, key=lambda name: cv_results[name]['f1_macro_mean'])
assert winner == experiment['cv_winner']
print('Ganador por CV:', winner, '| activo en la plataforma:', experiment['active_model'])
"""),
        md("""## 6. Referencia de 80 consultas y matrices de confusión

Se ajustan ambos clasificadores con todo el entrenamiento. Accuracy es la
fracción de etiquetas correctas; precision, recall y F1 macro promedian por
categoría. La tabla usa la clase de mayor probabilidad, sin rechazo. Esta
referencia ya se utilizó durante el desarrollo; no es otra prueba final ciega.
La cobertura conversacional se informa aparte.
"""),
        code("""metric_names = ['accuracy', 'precision_macro', 'recall_macro', 'f1_macro']
predictions, observed = {}, {}
for name, pipeline in pipelines.items():
    pipeline.fit(train.text, train.intent)
    prediction = pipeline.predict(test.text)
    predictions[name] = prediction
    precision, recall, f1, _ = precision_recall_fscore_support(
        test.intent, prediction, average='macro', zero_division=0)
    observed[name] = dict(zip(metric_names, map(float, [accuracy_score(test.intent, prediction), precision, recall, f1])))
    for metric in metric_names:
        assert abs(observed[name][metric] - experiment['models'][name][metric]) < 1e-10
comparison = pd.DataFrame(observed).T
display(comparison)
comparison.plot.bar(figsize=(9, 4), ylim=(0, 1.05), rot=0, color=['#315340', '#78956a', '#a75a2a', '#caa579'])
plt.ylabel('Puntuación'); plt.title('Referencia expuesta: dos modelos, mismos datos'); plt.tight_layout(); plt.show()
"""),
        code("""fig, axes = plt.subplots(1, 2, figsize=(21, 9))
for ax, (name, prediction) in zip(axes, predictions.items()):
    ConfusionMatrixDisplay.from_predictions(test.intent, prediction, labels=labels,
        display_labels=labels, xticks_rotation=80, cmap='Greens', colorbar=False, ax=ax)
    ax.set_title(name); ax.set_xlabel('Predicción'); ax.set_ylabel('Etiqueta real')
plt.tight_layout(); plt.show()
display(pd.DataFrame(experiment['models'][active_model]['per_class']).T)
"""),
        md("""## 7. Quince etapas acumulativas

Cada etapa incorpora 16 ejemplos, uno por intención, hasta llegar a 240. La curva
de Naive Bayes se verifica contra la práctica entregada. Las aportaciones
posteriores no reescriben estas etapas. Los horarios y perfiles ficticios de la
base no acreditan quince días de sesiones reales ni participación de personas.
"""),
        code("""curve = pd.DataFrame(experiment['curve'])
assert list(curve.day) == list(range(1, 16))
assert bool(experiment['curve_verified'])
display(curve[['day', 'total_examples', 'correct', 'total', 'accuracy', 'precision_macro', 'accepted']])
ax = curve.plot(x='day', y=['accuracy', 'precision_macro'], marker='o', figsize=(10, 4),
                ylim=(0, 1.05), color=['#315340', '#a75a2a'], title='Quince etapas de entrenamiento acumulativo')
ax.set_xlabel('Etapa'); ax.set_ylabel('Resultado sobre la referencia'); ax.set_xticks(range(1, 16))
plt.tight_layout(); plt.show()
"""),
        md("""## 8. Errores del modelo activo y rechazo

Se muestran errores observados del clasificador seleccionado. La interpretación vincula
la consulta, su categoría y la predicción con las limitaciones léxicas; se
escogen tres categorías distintas cuando hay suficientes errores.

Una clase correcta de máxima probabilidad puede ser rechazada por baja confianza.
La cobertura y los aciertos entre aceptadas explican lo que ve el usuario.
Las probabilidades no están calibradas y los umbrales son heurísticos.
"""),
        code("""errors = [row for row in experiment['errors'] if row['model'] == active_model]
print('Errores observados del modelo activo:', len(errors))
if errors:
    display(pd.DataFrame(errors)[['text', 'expected', 'predicted', 'interpretation']])
    selected_errors, covered = [], set()
    for error in errors:
        if error['expected'] not in covered:
            selected_errors.append(error); covered.add(error['expected'])
        if len(selected_errors) == 3: break
    for error in selected_errors:
        print('\\nConsulta:', error['text'])
        print('Esperada:', error['expected'], '| predicha:', error['predicted'])
        print('Interpretación:', error['interpretation'])
else:
    print('No hubo errores en esta instantánea de referencia; esto no garantiza generalización.')
acceptance = experiment['acceptance']
display(acceptance)
print('Cobertura:', acceptance['accepted'] / acceptance['total'])
print('Acierto entre aceptadas:', acceptance['correct_accepted'] / acceptance['accepted'] if acceptance['accepted'] else 'sin aceptadas')
gap = {name: observed[name]['f1_macro'] - cv_results[name]['f1_macro_mean'] for name in pipelines}
print('Diferencia F1 referencia - F1 medio de CV:', gap)
print('La distancia entre CV y referencia exige cautela: no demuestra robustez ante consultas reales.')
"""),
        md("""## 9. Integración, diálogo y colaboración

La aplicación carga la última versión aprobada. Cada entrenamiento crea una
jornada con instantánea de datos y ambos modelos, conservando versiones previas.
El resultado nuevo es provisional hasta revisar sus comprobaciones y activarlo.
Sin una versión aprobada se conserva el modelo base de referencia.
`web/ml.js` aplica los parámetros exportados. `web/dialogue.js` conserva equipo,
falla, etapa y respuestas; el estado modifica las preguntas y el resumen durante
tres turnos. Las reglas atienden controles, respuestas cortas, elecciones y
alertas; el clasificador determina las intenciones ordinarias.

Antes del turno se usa `recibir-aportes.cmd`; luego `iniciar.cmd`, responsable,
consultas y revisión de categorías. Los ejemplos empiezan pendientes; solo los
aprobados entran en la siguiente jornada. `subir-aportes.cmd` confirma y envía
`data/team/`. Se conserva la hora de cada consulta. Los modelos personalizados
siguen locales y se reentrenan después de recibir ejemplos. Las predicciones
del propio bot no se incorporan automáticamente como etiquetas correctas.

La evidencia siguiente corresponde al modelo base con la misma configuración
de la página; no representa sesiones de alumnos. Se regenera con
`node scripts/check-current-dialogue.mjs`. La suite general usa
`node --test tests/*.test.mjs`. La ausencia de evidencia se informa sin inventarla.
"""),
        code("""evidence_path = ROOT/'reports/current-dialogue-results.json'
if evidence_path.is_file():
    evidence = json.loads(evidence_path.read_text(encoding='utf-8-sig'))
    print('Evidencia de diálogo:', evidence_path.relative_to(ROOT))
    print(evidence.get('scope', ''))
    print('Pruebas aprobadas:', evidence.get('passed'), '/', evidence.get('total'))
    display(evidence.get('cases', []))
    display(evidence)
else:
    print('No hay evidencia actual de diálogo adjunta; ejecutar las pruebas Node por separado.')
"""),
        md("""## 10. Comprobaciones y conclusiones

Los hashes verifican que el experimento no reemplazó datos ni modelos
protegidos. Sin aportaciones adicionales, el Naive Bayes reproducido debe
coincidir con el modelo de etapa 15 y su exactitud publicada. Con ejemplos
nuevos, las métricas corresponden a la instantánea identificada.

**Pendientes de datos y evaluación final:** ampliar las 15 muestras por intención
de la base hasta al menos 20, revisar su diversidad y aportar una prueba final
reservada con al menos 50 expresiones nuevas. La referencia de 80 ya conocida
sigue siendo un benchmark de desarrollo. La baja CV respecto a esa referencia y
las probabilidades sin calibración limitan la interpretación de sus resultados.
Las frases indirectas y las fallas múltiples pueden producir rechazo o error.
El gestor conserva tres variantes también en el modo breve, mantiene el contexto
y solicita aclaración cuando no hay evidencia suficiente.

El chatbot orienta comprobaciones externas; no confirma componentes dañados ni
la eficacia de una reparación. Todos los integrantes deben comprender los dos
clasificadores, el preprocesamiento, las métricas y el gestor para la demostración.

Referencias oficiales: [extracción de texto](https://scikit-learn.org/stable/modules/feature_extraction.html#text-feature-extraction),
[filtración de datos](https://scikit-learn.org/stable/common_pitfalls.html#data-leakage),
[regresión logística](https://scikit-learn.org/stable/modules/linear_model.html#logistic-regression),
[Naive Bayes](https://scikit-learn.org/stable/modules/naive_bayes.html#multinomial-naive-bayes).
"""),
        code("""after_hashes = {name: sha256((ROOT/name).read_bytes()).hexdigest() for name in protected}
assert before_hashes == after_hashes, 'Se modificó un archivo protegido'
display(experiment['hashes'])
export_path = Path(experiment.get('model_path') or ROOT/'web/simulation/day-15.json')
exported = json.loads(export_path.read_text(encoding='utf-8'))
fitted = pipelines[active_model]
vectorizer, classifier = fitted.named_steps['tfidf'], fitted.named_steps['classifier']
assert vectorizer.get_feature_names_out().tolist() == exported['features']
assert np.allclose(vectorizer.idf_, exported['idf'], rtol=0, atol=1e-12)
weights = classifier.feature_log_prob_ if active_model == 'naive_bayes' else classifier.coef_
assert np.allclose(weights, exported['weights'], rtol=0, atol=1e-12)
assert winner == experiment['cv_winner']
print('Modelo y vectorizador reproducidos coinciden con la versión documentada:', export_path.name)
print('CV, dos modelos y métricas reproducidos. No se alteraron datos ni modelos protegidos.')
"""),
    ], metadata={
        'kernelspec': {'display_name': 'Python 3', 'language': 'python', 'name': 'python3'},
        'language_info': {'name': 'python', 'version': '3.12'},
    })
    for cell in notebook.cells:
        if cell.cell_type == 'code':
            cell.source = cell.source.replace('DOCUMENT_VERSION = None', 'DOCUMENT_VERSION = ' + repr(version_id))
    notebook.metadata['yinyan_version_id'] = version_id
    return notebook, ROOT/'notebooks/experimentacion.ipynb'


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', help='Jornada cuya instantánea se documentará; por defecto la versión aprobada activa.')
    args = parser.parse_args()
    notebook, destination = build(args.version)
    jupyter_root = ROOT/'.jupyter-local'
    kernel_path = jupyter_root/'kernels'/'yinyan-local'
    kernel_path.mkdir(parents=True, exist_ok=True)
    (kernel_path/'kernel.json').write_text(json.dumps({
        'argv': [sys.executable, '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
        'display_name': 'YinYan local', 'language': 'python',
    }), encoding='utf-8')
    os.environ['JUPYTER_PATH'] = str(jupyter_root)
    os.environ['JUPYTER_CONFIG_DIR'] = str(jupyter_root/'config')
    os.environ['JUPYTER_DATA_DIR'] = str(jupyter_root/'data')
    os.environ['JUPYTER_RUNTIME_DIR'] = str(jupyter_root/'runtime')
    os.environ['IPYTHONDIR'] = str(jupyter_root/'ipython')
    os.environ['MPLCONFIGDIR'] = str(jupyter_root/'matplotlib')
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    def progress(cell, cell_index):
        if cell.cell_type == 'code':
            print(f'Ejecutando celda {cell_index + 1}/{len(notebook.cells)}...', flush=True)

    client = NotebookClient(notebook, timeout=600, kernel_name='yinyan-local',
                            resources={'metadata': {'path': str(ROOT)}}, on_cell_start=progress)
    client.execute()
    evaluated = json.loads((ROOT/'reports/current-experiment.json').read_text(encoding='utf-8'))
    notebook.metadata['yinyan_version_id'] = evaluated.get('version_id')
    notebook.metadata['yinyan_dataset_version'] = evaluated.get('dataset_version')
    for cell in notebook.cells:
        if cell.cell_type == 'code':
            cell.source = cell.source.replace('DOCUMENT_VERSION = None', 'DOCUMENT_VERSION = ' + repr(evaluated.get('version_id')))
    notebook.metadata['kernelspec'] = {'display_name': 'Python 3', 'language': 'python', 'name': 'python3'}
    # Conservar el notebook entregado si una ejecución falla a mitad del proceso.
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + '.tmp')
    nbformat.write(notebook, temporary)
    temporary.replace(destination)
    print(f'Notebook ejecutado y guardado: {destination.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
