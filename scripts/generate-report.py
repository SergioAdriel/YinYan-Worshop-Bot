"""Reporte de la versión actual: datos, comparación y límites verificables.

Genera siete páginas principales, portada y referencias. No modifica el modelo
activo ni convierte las etapas sintéticas en un historial de trabajo real.
"""
from __future__ import annotations

from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import sys
from uuid import uuid4
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image, KeepInFrame, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
REPORTS = ROOT / "reports"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
MAIN_PAGES = 7
CUTOFF = "18 de noviembre de 2026"
BLUE = colors.HexColor("#27382f")
GREEN = colors.HexColor("#315340")
MUTED = colors.HexColor("#647265")
PALE = colors.HexColor("#edf1e9")
MODEL_NAMES = {"naive_bayes": "Naive Bayes", "logistic_regression": "Regresión logística"}


def fonts():
    candidates = [
        (Path("C:/Windows/Fonts/segoeui.ttf"), Path("C:/Windows/Fonts/segoeuib.ttf")),
        (Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")),
    ]
    for normal, bold in candidates:
        if normal.is_file() and bold.is_file():
            pdfmetrics.registerFont(TTFont("YinBody", str(normal)))
            pdfmetrics.registerFont(TTFont("YinBold", str(bold)))
            return "YinBody", "YinBold"
    return "Helvetica", "Helvetica-Bold"


FONT, BOLD = fonts()
STYLES = getSampleStyleSheet()
for name, font, size, leading, color in [
    ("Body", FONT, 9.2, 13.3, BLUE),
    ("Small", FONT, 8, 11.2, MUTED),
    ("Heading", BOLD, 17, 21, BLUE),
    ("Subheading", BOLD, 11, 15, GREEN),
    ("TableCell", FONT, 7.6, 10.2, BLUE),
    ("TableHeader", BOLD, 7.6, 10.2, colors.white),
    ("CoverTitle", BOLD, 31, 36, BLUE),
]:
    STYLES.add(ParagraphStyle(name="Yin" + name, fontName=font, fontSize=size,
                             leading=leading, textColor=color, spaceAfter=8))


def para(text, style="Body"):
    return Paragraph(escape(str(text)).replace("\n", "<br/>"), STYLES["Yin" + style])


def table(rows, widths):
    cells = [[para(value, "TableHeader" if index == 0 else "TableCell")
              for value in row] for index, row in enumerate(rows)]
    result = Table(cells, colWidths=widths, repeatRows=1, hAlign="LEFT")
    result.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return result


def percent(value):
    return f"{100 * value:.2f}%"


def atomic_text(path, content):
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        temporary.write_text(content, encoding="utf-8")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def notebook_evidence():
    path = ROOT / "notebooks/experimentacion.ipynb"
    notebook = json.loads(path.read_text(encoding="utf-8-sig"))
    cells = [cell for cell in notebook["cells"] if cell["cell_type"] == "code"]
    executed = sum(cell.get("execution_count") is not None for cell in cells)
    errors = sum(output.get("output_type") == "error" for cell in cells for output in cell.get("outputs", []))
    pngs = sum("image/png" in output.get("data", {}) for cell in cells for output in cell.get("outputs", []))
    return {"code_cells": len(cells), "executed_cells": executed, "error_outputs": errors,
            "png_outputs": pngs, "sha256": sha256(path.read_bytes()).hexdigest()}


def active_errors(experiment):
    errors = [error for error in experiment["errors"]
              if error["model"] == experiment["active_model"] and error["expected"] != error["predicted"]]
    chosen, seen = [], set()
    for error in errors:
        if error["expected"] not in seen:
            chosen.append(error)
            seen.add(error["expected"])
        if len(chosen) == 3:
            return chosen
    for error in errors:
        if error not in chosen:
            chosen.append(error)
        if len(chosen) == 3:
            return chosen
    return chosen


def interpret(error):
    observed = f"Etiqueta esperada: {error['expected']}; predicción: {error['predicted']}. "
    detail = error.get("interpretation") or (
        "El vocabulario de la frase no bastó para separar ambas necesidades. "
        "Un clasificador léxico puede dar demasiado peso a palabras compartidas y perder el sentido global. "
        "Es una hipótesis cualitativa, no una explicación causal de los pesos."
    )
    return observed + detail + " Si la confianza es insuficiente, el gestor pide aclaración; una etiqueta incorrecta no implica que siempre se haya mostrado una orientación incorrecta."


def build_sections(experiment, team, notebook):
    counts = experiment["counts"]
    cv = experiment["cv"]
    winner = experiment["cv_winner"]
    active = experiment["active_model"]
    acceptance = experiment["acceptance"]
    train = counts["per_intent"]
    minimum = experiment["requirements"].get("minimum_per_intent", 20)
    missing = sum(max(0, minimum - train[label]) for label in experiment["labels"])
    primary = team.get("desarrollador_principal", "Sergio Adriel Muñoz Camarena")
    cv_text = "; ".join(f"{MODEL_NAMES[name]}: F1 macro {values['f1_macro_mean']:.4f} ± {values['f1_macro_std']:.4f}"
                        for name, values in cv.items())
    curve_start, curve_end = experiment["curve"][0], experiment["curve"][-1]
    dialogue_path = REPORTS / "current-dialogue-results.json"
    functional = "Las pruebas de tests/ comprueban contexto, reinicio, aclaraciones, paridad, persistencia y servidores."
    if dialogue_path.is_file():
        dialogue = json.loads(dialogue_path.read_text(encoding="utf-8"))
        functional += f" El registro reports/current-dialogue-results.json contiene {dialogue['passed']}/{dialogue['total']} casos funcionales aprobados con el modelo actual, transcripciones de varios turnos y seis consultas de sondeo nuevas respecto al entrenamiento. Este archivo se distingue de la evidencia del experimento anterior."
    tests_path = REPORTS / 'test-results.json'
    if tests_path.is_file():
        tests = json.loads(tests_path.read_text(encoding='utf-8'))
        functional += f" La suite registró {tests['passed']}/{tests['tests']} pruebas aprobadas, {tests['failed']} fallidas y {tests['skipped']} omitidas, con ejecución terminada el {tests['finished_at']}."
    else:
        functional += ' La suite se reproduce con node scripts/run-tests.mjs; falta su registro actualizado.'
    browser_path = REPORTS / 'workflow-browser-results.json'
    if browser_path.is_file():
        browser = json.loads(browser_path.read_text(encoding='utf-8'))
        functional += f" El flujo de navegador registra {browser.get('passed', 0)} comprobaciones aprobadas y {browser.get('failed', 0)} fallidas; su alcance y fecha están en reports/workflow-browser-results.json."
    minimum_text = (
        f"Faltan {missing} ejemplos pertinentes y diversos para llegar al mínimo de {minimum} por intención. "
        "El total general supera 200, pero ese total no sustituye el mínimo de cada categoría."
        if missing else f"Todas las categorías alcanzan el mínimo de {minimum} ejemplos por intención."
    )
    return [
        ("1. Problema, objetivo y organización", [
            "YinYan Workshop es un prototipo de soporte técnico informático, correspondiente a la opción B. Su objetivo es interpretar consultas sobre computadoras, celulares y consolas, formular preguntas breves y ofrecer comprobaciones externas o derivación al taller.",
            "El alcance comprende fallas de encendido, carga, temperatura, rendimiento, conexión, pantalla, sonido, almacenamiento, software, controles y líquidos, además de saludo, despedida, ayuda, presupuesto y contacto. No confirma componentes dañados ni promete reparaciones, precios o citas.",
            f"El equipo está integrado por Erick Mendoza Mendoza y Daniel Gibran Luciano Tellez, responsables de construir y revisar el dataset; {primary}, desarrollador principal del chatbot, el gestor y la interfaz; y Raynier Jetsahe Torres Flores, responsable de integración, entrenamiento, comparación y verificación. Esta distribución corresponde a la indicada por el equipo; la bitácora conserva las aportaciones y ejecuciones verificables sin asignar cantidades históricas individuales.",
            "La aplicación separa clasificación supervisada, gestor de diálogo e interfaz. El aprendizaje consiste en ajustar TF-IDF y el clasificador a ejemplos etiquetados; las respuestas provienen de plantillas.",
            "La base de datos inicial y sus quince cortes acumulativos son sintéticos y conservan su procedencia. Los entrenamientos nuevos son jornadas ejecutadas realmente: cada una registra su fecha, responsable, versión de datos y resultados. El corte del 18 de noviembre es un avance funcional; la entrega final está prevista para el 4 de diciembre de 2026.",
            "El chat se ejecuta localmente. Node.js o Python escuchan en 127.0.0.1 y entregan la interfaz al navegador. GitHub comparte código y aportaciones; no es necesario un alojamiento público para cumplir la interfaz admitida por el profesor.",
        ]),
        ("2. Dataset, intenciones y procedencia", [
            f"La versión evaluada utiliza {counts['base']} ejemplos sintéticos de base y {counts['additional']} ejemplos adicionales activos: {counts['total']} en total, distribuidos entre {counts['intents']} intenciones. La evaluación contiene {counts['test']} consultas adicionales, separadas del ajuste. La tabla muestra los datos efectivos de esta ejecución.",
            minimum_text,
            "Las etiquetas representan necesidades comunicativas distintas; el equipo es una entidad del contexto, no una clase adicional. Su significado y acción se describen en docs/dominio-e-intenciones.md. Los ejemplos están en JSON y las consultas de evaluación en CSV.",
            "La base y sus quince etapas contienen ejemplos sintéticos de práctica. Algunas entradas contienen faltas, abreviaturas y acentos omitidos para representar redacciones de práctica; las respuestas mantienen buena ortografía. La revisión humana de pertinencia y diversidad debe documentarse antes de presentar el corpus como validado por el equipo.",
            "Los archivos de data/team/ contienen las aportaciones nuevas por responsable. Empiezan pendientes y pueden aprobarse o rechazarse después de revisar texto, etiqueta y diversidad. Solo los aprobados se incorporan a la siguiente jornada. La edición y retirada de pendientes conserva eventos; un ejemplo revisado debe reabrirse antes de cambiarlo. Se detectan duplicados normalizados y etiquetas contradictorias, sin tratar las respuestas del bot como etiquetas verdaderas.",
        ]),
        ("3. Preparación de texto y entrenamiento", [
            "Se convierte a minúsculas, se aplica Unicode NFD, se retiran diacríticos y se tokeniza con [a-z0-9]+. Se elimina puntuación y una lista breve de palabras vacías, conservando «no». Un diccionario explícito ofrece lematización ligera de flexiones frecuentes; no es un analizador morfológico completo.",
            "TF-IDF representa unigramas y bigramas, con frecuencia sublineal, IDF suavizado y normalización L2. El vocabulario y el IDF se aprenden exclusivamente con cada partición de entrenamiento. Python y JavaScript comparten las decisiones de preparación e inferencia, verificadas mediante pruebas de paridad.",
            "Se entrenan Multinomial Naive Bayes (alpha=0.25) y regresión logística (C=8, max_iter=2000) con los mismos ejemplos y representación. Se comparan con cinco pliegues estratificados, mezcla y semilla 42. La selección utiliza F1 macro promedio y el vectorizador se vuelve a ajustar dentro de cada pliegue.",
            cv_text + f". La selección por validación favorece a {MODEL_NAMES[winner]}. La versión documentada contiene {MODEL_NAMES[active]}; su identificador es {experiment.get('version_id', 'base de referencia')}. Cada jornada conserva ambos pipelines, el vectorizador, parámetros, distribución, métricas y matrices. El resultado se guarda provisionalmente y solo una activación explícita, después de comprobar integridad y paridad, cambia la versión activa.",
            "La elección por validación no consulta el resultado del conjunto de evaluación. Sin embargo, ese conjunto de 80 mensajes ya fue observado durante el desarrollo del proyecto. Sus cifras actuales son de evaluación de desarrollo; para una afirmación final independiente hace falta reservar una prueba nueva y no ajustarse a sus errores.",
            f"La curva de la base va de {curve_start['total_examples']} ejemplos y {curve_start['correct']}/{curve_start['total']} aciertos en la etapa inicial a {curve_end['total_examples']} ejemplos y {curve_end['correct']}/{curve_end['total']} en la etapa 15. Cada etapa ajusta un modelo real con los ejemplos acumulados; no se agregan errores aleatorios ni se fija un porcentaje de éxito.",
        ]),
        ("4. Resultados de la versión actual", [
            "Las cuatro métricas se calculan sobre la categoría más probable de cada consulta: accuracy, precision macro, recall macro y F1 macro. Los promedios macro asignan el mismo peso a cada intención. La tabla compara ambos algoritmos ajustados con el corpus actual.",
            f"El modelo activo es {MODEL_NAMES[active]}; el ganador por F1 macro de validación es {MODEL_NAMES[winner]}. El porcentaje de esta tabla mide clasificación, no calidad de reparación ni probabilidad de diagnóstico físico correcto.",
            f"El modelo activo acierta {experiment['models'][active]['correct']}/{experiment['models'][active]['total']} etiquetas. Su F1 macro de validación ({percent(cv[active]['f1_macro_mean'])}) es mucho menor que el F1 del conjunto de evaluación ({percent(experiment['models'][active]['f1_macro'])}). La menor cantidad de entrenamiento por pliegue y diferencias de dificultad o estilo entre particiones sintéticas pueden contribuir a la brecha; esta observación no demuestra su causa. Se necesita una prueba nueva de origen independiente para valorar generalización.",
            f"Con confianza mínima 0.24, margen 0.045 y cobertura léxica 0.20, el modelo activo acepta directamente {acceptance['accepted']}/{acceptance['total']} consultas. Entre las aceptadas acierta {acceptance['correct_accepted']}. En el resto puede pedir aclaración. Cobertura de aceptación y accuracy global son medidas diferentes: se cuenta una categoría más probable incluso cuando se rechaza para conversar.",
            "Las matrices usan etiqueta real en filas y predicción en columnas. Las celdas fuera de la diagonal muestran confusiones; sus imágenes originales y valores están disponibles en reports/ y en el notebook para ampliarlos. La variación de los resultados al agregar ejemplos no garantiza una mejora con usuarios reales.",
        ]),
        ("5. Diálogo, interfaz y colaboración local", [
            "El flujo recibe el mensaje, prepara el texto, clasifica la intención, consulta el estado, selecciona una respuesta y actualiza el contexto. El estado conserva dispositivo, falla, pregunta pendiente y respuestas previas. Una respuesta como «sí» completa la comprobación pendiente y modifica la orientación posterior.",
            "El gestor sostiene al menos tres turnos relacionados. Pregunta datos faltantes, conserva el dispositivo cuando una frase técnica no se clasifica y distingue un reinicio del equipo de un parpadeo de pantalla mediante opciones guiadas. Tras intentos sin aclarar ofrece contacto, evitando repetir indefinidamente el mismo mensaje.",
            "Las frases desconocidas, ambiguas o con baja confianza provocan aclaraciones o una explicación del alcance. Las opciones elegidas se registran como decisión del usuario; no se cuentan como aciertos del clasificador. Nueva consulta elimina el contexto. Las alertas de líquido o batería dañada priorizan detener el uso y acudir a revisión.",
            "La interfaz se organiza en Chat, Consultas y Entrenar. En Consultas se revisa el texto completo y su categoría antes de aprobar un ejemplo. El botón de entrenamiento usa la base y los ejemplos activos; después se selecciona el modelo personalizado para probarlo. Consultar y entrenar son operaciones distintas.",
            "Cada consulta y ejemplo se guarda en data/team/alumno-a/ o data/team/alumno-b/, con identificador, autor, fecha UTC asignada por el servidor y zona America/Mexico_City. La página muestra fecha y hora locales. Una revisión enlaza a su consulta con source_query_id; retirar un ejemplo añade un registro y conserva la conversación.",
            "Al iniciar un turno, recibir-aportes.cmd ejecuta pull. Al terminar, subir-aportes.cmd confirma data/team/ y hace push. El compañero recibe las fechas originales. El código y la bitácora viajan por Git; los modelos personales quedan en data/local/ y se reentrenan en cada computadora. El selector A/B identifica aportaciones, pero no autentica usuarios.",
        ]),
        ("6. Pruebas funcionales y errores observados", [
            functional,
            "Las comprobaciones distinguen pruebas aisladas del gestor con clasificación inyectada de pruebas con un modelo real. Se cubren paráfrasis, mensajes nuevos, tres turnos, ambigüedad, consultas fuera del dominio, recuperación de consultas y reinicio del contexto.",
            "Los casos siguientes son errores observados del clasificador seleccionado, hasta tres de categorías distintas cuando existen. Las interpretaciones ayudan a discutir cobertura léxica y contexto; no se reutilizan estas frases como entrenamiento para mejorar artificialmente el mismo conjunto de evaluación. Si no se observan tres errores, se informa la cantidad disponible.",
        ]),
        ("7. Conclusiones, pendientes y reproducción", [
            "El prototipo integra un clasificador supervisado propio, un proceso de preparación reproducible, contexto conversacional y una interfaz local que permite revisión humana y entrenamiento colaborativo. La comparación actual de dos algoritmos y sus métricas permite explicar sus diferencias sin confundirlas con las de versiones anteriores.",
            minimum_text + " El trabajo posterior consiste en incorporar datos, revisar, aprobar, entrenar, evaluar y guardar una jornada. El panel muestra el déficit por intención y el estado de los requisitos. La revisión humana de diversidad, el enlace del repositorio y la defensa de todos los integrantes deben acompañar la entrega final.",
            "Los resultados provienen de datos pequeños y sintéticos. Persisten límites ante jerga, negación compleja, paráfrasis poco cubiertas y dos fallas simultáneas. La confianza no está calibrada para afirmar certeza de diagnóstico. La evaluación ya consultada debe complementarse con una prueba nueva reservada para la entrega final.",
            "Para reproducir: instalar requirements-lock.txt; iniciar.cmd abre el servidor. El botón Entrenar modelo crea una jornada; su activación es un paso posterior. reproducir-notebook.cmd y generar-reporte.cmd actualizan los documentos; --version permite seleccionar una jornada congelada. La prueba final preparada en data/final-test.csv debe contener al menos 50 consultas nuevas y mantenerse reservada; no se usa al entrenar ni para seleccionar modelos.",
            f"El notebook notebooks/experimentacion.ipynb registra {notebook['executed_cells']}/{notebook['code_cells']} celdas de código ejecutadas, {notebook['png_outputs']} salidas PNG y {notebook['error_outputs']} errores de ejecución. Su contenido, dependencias y resultados deben acompañar el mismo corpus de esta revisión. Las cifras no afirman una nueva prueba en Chrome.",
        ]),
    ]


def page_decor(canvas, document):
    number = document.page
    if number == 1:
        return
    canvas.saveState()
    canvas.setFillColor(MUTED)
    canvas.setFont(BOLD, 8)
    canvas.drawString(1.7 * cm, A4[1] - 1.08 * cm, "YINYAN WORKSHOP · PROYECTO FINAL I")
    canvas.setFont(FONT, 7)
    label = f"Contenido principal · {number - 1} / {MAIN_PAGES}" if number <= MAIN_PAGES + 1 else "Referencias · fuera del contenido principal"
    canvas.drawString(1.7 * cm, .95 * cm, label)
    canvas.restoreState()


def graphic(path, width):
    if not path.is_file():
        raise FileNotFoundError(f"Falta la figura del experimento actual: {path}")
    result = Image(str(path))
    ratio = result.imageHeight / result.imageWidth
    result.drawWidth, result.drawHeight = width, width * ratio
    return result


def main():
    import argparse
    from src.current_experiment import build_current_experiment
    from pypdf import PdfReader

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', help='Jornada que se documentará; por defecto la versión aprobada activa.')
    args = parser.parse_args()
    experiment = build_current_experiment(write_outputs=True, version_id=args.version)
    metrics_path = REPORTS / "current-experiment.json"
    team = json.loads((DOCS / "equipo.json").read_text(encoding="utf-8-sig"))
    notebook = notebook_evidence()
    labels = experiment["labels"]
    train = experiment["counts"]["per_intent"]
    evaluation = experiment["snapshot_data"]["evaluation"]
    test = Counter(row.get("intent", row.get("expected")) for row in evaluation)
    errors = active_errors(experiment)
    sections = build_sections(experiment, team, notebook)
    matrices = [REPORTS / f"current-confusion-{name}.png" for name in MODEL_NAMES]
    width, height = A4[0] - 3.4 * cm, A4[1] - 3.4 * cm
    primary = team.get("desarrollador_principal", "Sergio Adriel Muñoz Camarena")
    members = "; ".join(team.get("integrantes", [])) or "Por completar"
    cover = [Spacer(1, .9 * cm), para("YINYAN\nWORKSHOP", "CoverTitle"), Spacer(1, .3 * cm),
             para("Prototipo funcional de chatbot inteligente", "Heading"),
             para("Avance al 18 de noviembre de 2026", "Subheading"),
             para(team["asignatura"]), para("Opción B · Aprendizaje supervisado · Aplicación local"),
             Spacer(1, .6 * cm), para("Desarrollador principal: " + primary)]
    cover_fields = [("Integrantes declarados", members)]
    for field, key in [("Grupo", "grupo"), ("Institución", "institucion")]:
        value = team.get(key, "").strip()
        if value and "completar" not in value.lower() and "pendiente" not in value.lower():
            cover_fields.append((field, value))
    cover_fields.extend([("Docente", team["docente"]), ("Fecha de corte", CUTOFF), ("Entrega final prevista", '4 de diciembre de 2026')])
    for name, value in cover_fields:
        cover.append(para(f"{name}: {value}"))
    cover.extend([Spacer(1, .6 * cm), para("Quince etapas acumulativas de práctica sobre datos sintéticos; las nuevas aportaciones se registran con su hora real.", "Small"),
                  para("Portada y referencias fuera del límite de ocho cuartillas principales. Este reporte contiene siete páginas principales. Los campos pendientes deben completarse con información real del equipo.", "Small")])
    story = [KeepInFrame(width, height, cover, mode="shrink"), PageBreak()]
    markdown = ["# " + team["proyecto"], "", "Fecha de corte: " + CUTOFF,
                "Desarrollador principal: " + primary, "Docente: " + team["docente"],
                "Integrantes declarados: " + members, "", "Siete páginas principales; portada y referencias separadas.", ""]
    for index, (heading, paragraphs) in enumerate(sections):
        body = [para(heading, "Heading")]
        markdown.extend(["## " + heading, "", *[text + "\n" for text in paragraphs]])
        if index == 1:
            body.append(para(paragraphs[0]))
            rows = [["Intención", "Entrenamiento", "Evaluación"]] + [[label, str(train[label]), str(test[label])] for label in labels]
            body.extend([table(rows, [width * .54, width * .25, width * .21]), Spacer(1, .2 * cm)])
            body.extend(para(text) for text in paragraphs[1:])
            markdown.extend(["| Intención | Entrenamiento | Evaluación |", "| --- | ---: | ---: |",
                             *[f"| {label} | {train[label]} | {test[label]} |" for label in labels], ""])
        elif index == 3:
            body.append(para(paragraphs[0]))
            rows = [["Modelo", "Accuracy", "Precision macro", "Recall macro", "F1 macro"]]
            for name in MODEL_NAMES:
                model = experiment["models"][name]
                rows.append([MODEL_NAMES[name], *[percent(model[key]) for key in ["accuracy", "precision_macro", "recall_macro", "f1_macro"]]])
            body.extend([table(rows, [width * .32] + [width * .17] * 4), Spacer(1, .2 * cm)])
            body.extend(para(text) for text in paragraphs[1:])
            image_width = (width - .2 * cm) / 2
            body.extend([Table([[graphic(path, image_width) for path in matrices]], colWidths=[image_width, image_width]),
                         para("Matrices actuales: Naive Bayes y regresión logística, respectivamente. Originales ampliables en reports/.", "Small")])
            markdown.extend(["| Modelo | Accuracy | Precision macro | Recall macro | F1 macro |", "| --- | ---: | ---: | ---: | ---: |",
                             *["| " + " | ".join(row) + " |" for row in rows[1:]], "",
                             *[f"![{path.stem}](../reports/{path.name})\n" for path in matrices]])
        elif index == 5:
            body.extend(para(text) for text in paragraphs)
            for number, error in enumerate(errors, 1):
                title = f"Error {number} · {MODEL_NAMES[experiment['active_model']]} · evaluación de desarrollo"
                body.extend([para(title, "Subheading"), para("«" + error["text"] + "»", "Small"), para(interpret(error), "Small")])
                markdown.extend(["### " + title, "", "Mensaje: «" + error["text"] + "».", "", interpret(error), ""])
        else:
            body.extend(para(text) for text in paragraphs)
            if index == 6:
                curve_path = REPORTS / "current-learning-curve.png"
                body.append(graphic(curve_path, width * .85))
                body.append(para("Curva de la base sintética, sin mezclar las aportaciones adicionales. Cada punto representa un modelo entrenado con los ejemplos acumulados de su etapa.", "Small"))
                markdown.extend([f"![Evolución por etapas](../reports/{curve_path.name})", ""])
        story.extend([KeepInFrame(width, height, body, mode="shrink"), PageBreak()])
    bibliography = [
        "Consigna del curso. Proyecto Final I: Chatbot Inteligente mediante Aprendizaje Automático. Documento proporcionado por el usuario; entrega indicada el 4 de diciembre.",
        "scikit-learn. User Guide: extracción de características textuales, pipelines, validación cruzada y métricas de clasificación. https://scikit-learn.org/stable/user_guide.html",
        "Pedregosa, F. et al. (2011). Scikit-learn: Machine Learning in Python. Journal of Machine Learning Research, 12, 2825–2830. https://jmlr.org/papers/v12/pedregosa11a.html",
        "Python Software Foundation. Documentación de Python y http.server. https://docs.python.org/3/library/http.server.html",
        "YinYan Workshop. Perfil de contacto proporcionado: https://www.instagram.com/yinyan_workshop/. No se usó como fuente de consultas de entrenamiento.",
    ]
    evidence = f"Fuentes: instantánea de la jornada {experiment.get('version_id', 'base de referencia')}; data/simulation.json y data/team/; src/training_runs.py y src/preprocessing.py; web/ml.js y web/dialogue.js; reports/current-experiment.json y sus figuras; tests/; notebooks/experimentacion.ipynb. Clasificador documentado: {MODEL_NAMES[experiment['active_model']]}."
    reference_body = [para("Referencias y trazabilidad", "Heading"), para("Esta página no cuenta como contenido principal.", "Small"),
                      *[para(f"[{number}] {value}", "Small") for number, value in enumerate(bibliography, 1)],
                      para("Evidencia y reproducción", "Subheading"), para(evidence, "Small"),
                      para("SHA-256 de reports/current-experiment.json: " + sha256(metrics_path.read_bytes()).hexdigest(), "Small"),
                      para("SHA-256 del notebook: " + notebook["sha256"], "Small")]
    story.append(KeepInFrame(width, height, reference_body, mode="shrink"))
    markdown.extend(["## Referencias", "", *[value + "\n" for value in bibliography], evidence, ""])
    output = DOCS / "reporte-tecnico.pdf"
    temporary = output.with_name(f".{output.stem}.{uuid4().hex}.pdf")
    try:
        document = SimpleDocTemplate(str(temporary), pagesize=A4, rightMargin=1.7 * cm,
                                     leftMargin=1.7 * cm, topMargin=1.8 * cm, bottomMargin=1.6 * cm,
                                     title=team["proyecto"], author=primary,
                                     subject="Reporte de la versión actual de soporte técnico local")
        document.build(story, onFirstPage=page_decor, onLaterPages=page_decor)
        pages = len(PdfReader(temporary).pages)
        if pages != MAIN_PAGES + 2:
            raise ValueError(f"Se esperaban {MAIN_PAGES + 2} páginas (portada, siete principales y referencias); se obtuvieron {pages}.")
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    atomic_text(DOCS / "reporte-tecnico.md", "\n".join(markdown))
    verification = {"pdf": "docs/reporte-tecnico.pdf", "cutoff_date": "2026-11-18",
                    "pages": pages, "main_content_pages": MAIN_PAGES, "cover_pages": 1, "reference_pages": 1,
                    "metrics_path": "reports/current-experiment.json", "metrics_sha256": sha256(metrics_path.read_bytes()).hexdigest(),
                    "active_model": experiment["active_model"], "cv_winner": experiment["cv_winner"],
                    "selected_model": experiment["active_model"], "actual_errors_available": sum(error["model"] == experiment["active_model"] for error in experiment["errors"]),
                    "reported_error_texts": [error["text"] for error in errors], "notebook": notebook,
                    "team_information_pending": any("completar" in str(value).lower() or "pendiente" in str(value).lower() for value in team.values()),
                    "version_id": experiment.get('version_id'), "dataset_version": experiment.get('dataset_version'),
                    "provenance_note": "Base sintética identificada; jornadas posteriores con hora real y versiones conservadas.",
                    "test_is_development_evaluation": True}
    atomic_text(DOCS / "pdf-verification.json", json.dumps(verification, ensure_ascii=False, indent=2) + "\n")
    from src.delivery_verification import verify_delivery
    verify_delivery()
    from src.project_status import write_status
    write_status()
    print(json.dumps(verification, ensure_ascii=False))


if __name__ == "__main__":
    main()
