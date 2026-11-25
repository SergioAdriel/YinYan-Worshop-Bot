"""Generate the progress summary and requirement matrix from current evidence."""
from datetime import datetime, timezone
import json
from pathlib import Path
from scripts.team_store import TeamStore
from src.training_runs import Registry, atomic_json, progress, read_json

ROOT = Path(__file__).resolve().parents[1]


def write_status():
    registry = Registry()
    snapshot = TeamStore(ROOT, registry.runtime).snapshot()
    state = progress(snapshot, registry.runtime)
    tests = read_json(ROOT / 'reports/test-results.json', {})
    browser = read_json(ROOT / 'reports/workflow-browser-results.json', {})
    delivery = read_json(ROOT / 'reports/current-delivery-verification.json', {})
    active = state['active'].get('version')
    checked = {row['id']: row['status'] for row in state['rubric']}
    verified = tests.get('complete') and checked['context'] == 'Cumplido'
    functionality = 'Cumplido' if verified else 'Pendiente de verificación'
    evidence = 'reports/test-results.json; tests/; reports/workflow-browser-results.json'
    rows = [
        ('Dominio único y delimitado, opción B', 'Cumplido', 'docs/dominio-e-intenciones.md: soporte de computadoras, celulares y consolas.'),
        ('Diez intenciones con significado y acciones', 'Cumplido', '16 intenciones en data/simulation.json y docs/dominio-e-intenciones.md.'),
        ('Doscientos ejemplos de entrenamiento', 'Cumplido' if state['counts']['approved'] >= 200 else 'Pendiente de datos', f"{state['counts']['approved']} muestras de base y aportaciones aprobadas."),
        ('Veinte ejemplos por intención', checked['dataset'], f"Faltan {state['missing_examples_total']} ejemplos aprobados; tabla por intención más abajo."),
        ('Procedencia y datos estructurados', 'Cumplido', 'JSON/CSV; base sintética identificada y eventos reales nuevos en data/team/.'),
        ('Diversidad y revisión humana de los ejemplos nuevos', 'Pendiente de datos', 'Flujo de revisión implementado; completar y revisar las expresiones que faltan.'),
        ('Ausencia de duplicados y etiquetas contradictorias', functionality, 'Tokenización compartida y rechazo de coincidencias con base, benchmark y prueba final; tests/example-review.test.mjs.'),
        ('Prueba final independiente de al menos 50 consultas', checked['final'], f"data/final-test.csv: {state['final_test_size']} consultas; benchmark conocido separado de 80 mensajes."),
        ('Normalización, limpieza y caracteres especiales', checked['pln'], 'src/preprocessing.py; web/ml.js; pruebas de paridad.'),
        ('Tokenización y lematización ligera', checked['pln'], 'Diccionario explícito, negación conservada y mismo proceso en entrenamiento e inferencia.'),
        ('TF-IDF ajustado dentro de cada partición', checked['pln'], 'Pipeline unigramas/bigramas, frecuencia sublineal y normalización L2.'),
        ('Dos clasificadores supervisados propios', checked['models'], 'Naive Bayes y regresión logística por jornada; pipelines guardados con joblib.'),
        ('Validación comparable y selección justificada', checked['models'], 'Cinco pliegues estratificados, semilla 42 y máximo F1 macro; benchmark y prueba final no eligen el modelo.'),
        ('Vectorizador y clasificador almacenados', functionality, 'data/training/runs/<UUID>/: ambos pipelines y exportaciones JSON verificadas.'),
        ('Accuracy, precision, recall y F1 macro', checked['models'], 'run.json y las dos tablas de modelos de cada jornada.'),
        ('Dos matrices de confusión', checked['models'], 'JSON y figuras confusion-*.png dentro de cada jornada.'),
        ('Tres errores reales interpretados, cuando existen', checked['models'], 'Errores observados en run.json, notebook y PDF; no se fabrican si hay menos.'),
        ('Clasificación automática y respuestas coherentes', functionality, 'web/ml.js; web/dialogue.js; comprobación funcional de la versión aprobada.'),
        ('Tres variantes de respuesta cuando corresponde', checked['context'], 'Modo sencillo conserva variantes sociales y orientaciones; tests/concise.test.mjs.'),
        ('Contexto efectivo durante tres turnos', checked['context'], 'Equipo, falla y respuestas pendientes modifican el siguiente mensaje y el resumen.'),
        ('Ambigüedad, desconocidos y temas ajenos', checked['context'], 'Aclaración incluso con clasificación confiada de una frase sin síntoma; recuperación guiada.'),
        ('Reinicio del contexto', checked['context'], 'Nueva consulta y comando explícito de reinicio; historial y estado de conversación reiniciados.'),
        ('Interfaz web funcional y móvil', functionality, evidence),
        ('Guardar ejemplos antes del entrenamiento', functionality, 'UUID, autor, hora, estado y versión; eventos inmutables y persistencia tras reinicio.'),
        ('Pendiente, aprobado y rechazado', functionality, 'Edición/retiro de pendientes y reapertura controlada de revisados; solo aprobados se entrenan.'),
        ('Jornadas reales y numeración automática', functionality, 'Reserva exclusiva, ID único, instante UTC real y estado failed si no termina.'),
        ('Modelos provisional, activo e histórico', functionality, 'Activación explícita, validación de artefactos y recuperación de versiones anteriores.'),
        ('Comparación con entrenamiento anterior', functionality, 'Métricas y diferencias por jornada, sin forzar mejora ni reemplazo automático.'),
        ('Panel de progreso y cumplimiento', functionality, 'Conteos, distribución, faltantes, versiones, fecha y estados basados en evidencia.'),
        ('Evaluación final preparada y protegida', functionality, 'Acción explícita; mínimo 50, separación de datos y recibo semántico que impide reutilizar la prueba para comparar otra versión.'),
        ('Cuatro responsables consistentes', 'Cumplido', 'docs/equipo.json y selector: Erick, Daniel, Sergio y Raynier; no se afirma autenticación por roles.'),
        ('Repositorio compartible con instalación Windows', functionality, 'README, .cmd, requirements-lock.txt y ayudantes Git probados con dos clones temporales.'),
        ('Notebook ejecutable de la versión elegida', checked['documents'], 'notebooks/experimentacion.ipynb; --version; CV y métricas reproducidas con su instantánea.'),
        ('PDF de máximo ocho cuartillas principales', checked['documents'], f"docs/reporte-tecnico.pdf: {delivery.get('main_content_pages', 'por verificar')} páginas principales; hashes en docs/pdf-verification.json."),
        ('Referencia anterior conservada', 'Cumplido' if delivery.get('reference_files_intact') else 'Pendiente de verificación', 'references/captura/BACKUP.json y copia recuperable de 152 archivos.'),
        ('URL del repositorio GitHub entregada al profesor', 'Pendiente de verificación', 'Configuración preparada; no se proporcionó una URL de repositorio para verificar publicación o entrega.'),
        ('Defensa y comprensión de todos los integrantes', 'Pendiente de verificación', 'Guía de demostración disponible; la presentación en vivo corresponde al equipo.'),
    ]
    title = '# Prototipo funcional — Avance al 18 de noviembre de 2026'
    lines = [title, '', 'Entrega final prevista: **4 de diciembre de 2026**. Esta matriz distingue infraestructura comprobada, datos pendientes y verificaciones de entrega; no declara terminado el proyecto.', '',
             'Estados: **Cumplido**, **Pendiente de datos**, **Pendiente de verificación**, **No cumplido**.', '',
             '| Requisito | Estado | Evidencia |', '| --- | --- | --- |']
    lines += [f'| {name} | {status} | {description} |' for name, status, description in rows]
    lines += ['', '## Distribución del dataset', '', '| Intención | Base | Aprobados con base | Pendientes | Rechazados | Faltan para 20 |', '| --- | ---: | ---: | ---: | ---: | ---: |']
    lines += [f"| {row['intent']} | {row['base']} | {row['approved']} | {row['pending']} | {row['rejected']} | {row['missing']} |" for row in state['per_intent']]
    lines += ['', f"Faltan **{state['missing_examples_total']} ejemplos aprobados de entrenamiento** y **{max(0, 50-state['final_test_size'])} consultas de prueba final**. No se generaron muestras para aparentar cumplimiento.", '', '## Verificación del avance', '',
              f"Suite de pruebas: {tests.get('passed', 0)}/{tests.get('tests', 0)} aprobadas, {tests.get('failed', 0)} fallidas, {tests.get('skipped', 0)} omitidas.",
              f"Navegador: {browser.get('passed', 0)} comprobaciones aprobadas y {browser.get('failed', 0)} fallidas; jornadas de QA aisladas en Temp."]
    if active:
        values = active['models'][active['selected_model']]
        lines += ['', f"Modelo activo: **{active['selected_model']}**, jornada **{active['journey']}**, UUID `{active['id']}`.",
                  f"Ejecución real: `{active['created_at']}` a `{active['finished_at']}`; responsable `{active['author']}`.",
                  f"Benchmark conocido: {values['correct']}/{values['total']} aciertos ({100*values['accuracy']:.2f} %), F1 macro {100*values['f1_macro']:.2f} %. Se seleccionó por validación cruzada, no por estas cifras."]
    lines += ['', 'Las pruebas del sistema verifican componentes y flujos; no sustituyen la revisión lingüística, la nueva prueba reservada ni la demostración con preguntas del docente.', '']
    (ROOT / 'ESTADO-RUBRICA.md').write_text('\n'.join(lines), encoding='utf-8')
    (ROOT / 'docs/trazabilidad.md').write_text('# Trazabilidad del avance\n\nLa matriz vigente se genera a partir de las jornadas y la evidencia comprobada:\n\n[Estado completo de la rúbrica](../ESTADO-RUBRICA.md).\n\n[Flujo de incorporación, aprobación y entrenamiento](FLUJO-DE-TRABAJO.md).\n\nLos documentos históricos están conservados en references/captura/.\n', encoding='utf-8')
    summary = f'''YINYAN WORKSHOP - PROTOTIPO FUNCIONAL
AVANCE AL 18 DE NOVIEMBRE DE 2026. ENTREGA FINAL: 4 DE DICIEMBRE.

ANTES: chatbot local con base de 240 ejemplos, reentrenamiento de un algoritmo,
bitacora y una curva de referencia. El modelo personalizado se sobrescribia.

AHORA: cuatro responsables con los nombres indicados por el equipo; ejemplos
pendientes, aprobados y rechazados; edicion, reapertura y duplicados controlados.
Cada entrenamiento compara Naive Bayes, regresion logistica y Random Forest con validacion
comparable, guarda una jornada provisional y conserva las anteriores.

PARA TRABAJAR:
1. Recibir aportes desde Git y abrir iniciar.cmd.
2. Elegir responsable. Guardar ejemplos en Ejemplos y entrenar.
3. Revisar texto, categoria y diversidad; aprobar los preparados.
4. Pulsar Entrenar modelo. Solo se incorporan los aprobados.
5. Revisar resultados en Jornadas y activar explicitamente cuando corresponda.
6. Usar subir-aportes.cmd para compartir registros e historial.

JORNADAS: cada ejecucion recibe UUID, numero y hora reales; varias en un dia
son diferentes. Los fallos se conservan como fallos. Una version nueva no
sustituye automaticamente el modelo activo. Se puede recuperar una anterior.

GUARDADO: data/team/ contiene consultas, ejemplos y revisiones. data/training/
conserva jornadas, modelos, vectorizadores, configuracion, matrices y active.json.
data/local/ guarda caches; references/captura/ conserva el estado previo.

DOCUMENTACION: reproducir-notebook.cmd y generar-reporte.cmd admiten --version
UUID. El PDF comprueba el notebook y los artefactos al regenerarse. README y
docs/FLUJO-DE-TRABAJO.md explican el proceso y ESTADO-RUBRICA.md los requisitos.

PENDIENTE: incorporar {state['missing_examples_total']} ejemplos de entrenamiento aprobados, con al menos
20 por intencion; aportar {max(0,50-state['final_test_size'])} consultas adicionales al conjunto final reservado
data/final-test.csv, completar su revision y ejecutar la evaluacion final.
El benchmark de 80 consultas es de desarrollo y no elige el clasificador.
Verificar la URL de GitHub y practicar la defensa de todos los integrantes.
No hacen falta nuevos componentes basicos para continuar ese flujo.
'''
    (ROOT / 'RESUMEN-CAMBIOS.txt').write_text(summary, encoding='utf-8')
    atomic_json(ROOT / 'reports/project-status.json', {'generated_at': datetime.now(timezone.utc).isoformat(),
        'active_id': registry.active_id(), 'requirements': [{'requirement': name, 'status': status, 'evidence': description} for name, status, description in rows],
        'progress': state})
    return state


if __name__ == '__main__':
    print(json.dumps(write_status()['counts'], ensure_ascii=True))
