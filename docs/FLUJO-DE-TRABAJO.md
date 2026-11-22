# Prototipo funcional — Avance al 18 de noviembre de 2026

Entrega final prevista: **4 de diciembre de 2026**. El avance incluye la infraestructura para seguir incorporando datos y producir nuevas jornadas verificables. No representa la conclusión definitiva del proyecto.

## Equipo

| Responsable | Área | Funciones indicadas por el equipo |
| --- | --- | --- |
| Erick Mendoza Mendoza | Datos | Elaborar e incorporar ejemplos, preparar expresiones, clasificar por intención y revisar datos. |
| Daniel Gibran Luciano Tellez | Datos | Elaborar ejemplos, organizar el conjunto, revisar etiquetas y diversificar expresiones. |
| Sergio Adriel Muñoz Camarena | Desarrollo principal | Programación del chatbot, contexto conversacional, integración e interfaz. |
| Raynier Jetsahe Torres Flores | Desarrollo | Integración, entrenamiento, evaluación de clasificadores y verificación. |

El selector de responsable registra las operaciones. **No es autenticación ni control seguro de acceso por roles.** Las fechas las asigna el servidor al guardar; la página muestra Ciudad de México. Las responsabilidades no se convierten en registros históricos ni cantidades individuales inventadas.

## Incorporar, revisar y aprobar

1. Abre `recibir-aportes.cmd` para recibir cambios y después `iniciar.cmd`.
2. Selecciona tu nombre. En **Ejemplos y entrenar**, escribe una consulta y su intención. También puedes revisar una conversación desde **Consultas**.
3. Guarda: el registro queda **Pendiente**. Incluye UUID, texto, intención, responsable, fecha, estado y versión del dataset. Cerrar el navegador no lo elimina.
4. Revisa la categoría, la diversidad y si ya existe una frase equivalente. El sistema detecta coincidencias tras normalización, tokenización y lematización; la diversidad semántica requiere revisión humana.
5. Aprueba o rechaza el ejemplo. **Solo los aprobados** se incorporan a la siguiente jornada. Los pendientes pueden editarse o retirarse; para cambiar un ejemplo revisado, primero reábrelo como pendiente.
6. Consulta **Progreso**: indica los ejemplos aprobados, pendientes y rechazados por intención y cuántos faltan para llegar a veinte.

Los ejemplos y los eventos de revisión están en `data/team/`. Los originales no se sobrescriben: las modificaciones se materializan a partir de eventos. La revisión obsoleta de un texto no debe aprobar una versión editada después.

## Entrenar y elegir una versión

1. Sergio o Raynier revisan el dataset aprobado y pulsan **Entrenar modelo** con su responsable seleccionado.
2. El servidor reserva un UUID y un número de jornada, registra la hora real y congela una instantánea. Varias ejecuciones en el mismo día son jornadas diferentes.
3. Se entrenan Naive Bayes y regresión logística con el mismo TF-IDF y cinco pliegues estratificados. Se selecciona el mayor F1 macro medio de validación; el benchmark no elige el modelo.
4. Se guardan ambos pipelines, sus vectorizadores, exportaciones al navegador, configuración, distribución, métricas, matrices, predicciones y errores observados. Una jornada fallida conserva su estado de fallo y no reemplaza el modelo activo.
5. La versión terminada es **Provisional**. En **Jornadas** revisa resultados, comparación con la anterior y comprobaciones. La vista previa se identifica por separado del modelo activo.
6. Pulsa **Activar versión** cuando corresponda. Se verifican artefactos y paridad antes de cambiar el apuntador activo. El historial conserva las versiones anteriores y permite recuperarlas con otra activación explícita.

No se obliga a alcanzar un porcentaje fijo. Una mejora, empate o retroceso se presenta tal como se midió. Una versión con datos insuficientes por intención puede entrenarse provisionalmente, pero el panel mantiene el requisito como pendiente de datos.

## Benchmark y prueba final

`data/test.csv` contiene **80 consultas sintéticas ya observadas**. Se conserva como benchmark de desarrollo para comparar jornadas; no entra en el entrenamiento ni decide la selección del clasificador. Accuracy, precision macro, recall macro y F1 macro describen clasificación. El rechazo por confianza y la cobertura se muestran aparte.

`data/final-test.csv` empieza únicamente con la cabecera `text,intent`. Para la evaluación final:

1. Reúne **al menos 50 consultas adicionales** con etiquetas válidas y redactadas independientemente del entrenamiento y del benchmark conocido. Conserva el archivo UTF-8 con esas dos columnas; entrecomilla los textos que contengan comas.
2. Mantén su contenido reservado mientras se incorporan ejemplos y se selecciona el modelo por validación. No conviertas sus errores en nuevos ejemplos para seguir anunciando la misma prueba como inédita.
3. Con la versión elegida, ejecuta la acción **Evaluar prueba final** desde sus detalles. El sistema comprueba cantidad, etiquetas, duplicados y separación de datos antes de evaluar.
4. Se conserva un recibo de apertura del conjunto. La misma evaluación puede consultarse otra vez; no se usa repetidamente ese conjunto para comparar nuevas versiones. Si se desarrolla después de observarlo, prepara otra prueba reservada.

El archivo vacío no acredita el requisito: **faltan los datos finales**, aunque el procedimiento esté implementado y probado con datos temporales de QA. Esos datos de pruebas del sistema no se incorporan al corpus del proyecto.

## Compartir por Git y conservar modelos

Cada computadora ejecuta su servidor local. Antes del turno recibe cambios; al terminar usa `subir-aportes.cmd`. El repositorio comparte aportaciones y el historial versionado previsto para la entrega. No envía registros automáticamente mientras escribes ni se necesita GitHub Pages.

`data/local/` contiene cachés y estado propio del servidor; no se publica. La referencia anterior a esta ampliación está en `references/avance-2026-11-18/`, con fechas y hashes originales. El historial nuevo conserva sus horas reales y no rellena jornadas pasadas.

## Documentos y comprobaciones

La versión que documenta el notebook debe coincidir con la del PDF. Para una jornada concreta:

```powershell
python -m src.current_experiment --version UUID-DE-LA-JORNADA
node scripts/check-current-dialogue.mjs --version UUID-DE-LA-JORNADA
python -m src.create_notebook --version UUID-DE-LA-JORNADA
python scripts/generate-report.py --version UUID-DE-LA-JORNADA
```

La instalación portable utiliza `runtime\python\python.exe` y `runtime\node.exe` en lugar de `python` y `node`. Desde Windows, `reproducir-notebook.cmd` y `generar-reporte.cmd` permiten regenerar los documentos. Para comprobar el sistema:

```powershell
node scripts/run-tests.mjs
node scripts/workflow-browser-check.mjs
```

El segundo comando necesita Chrome y utiliza datos y jornadas temporales. Los registros de resultados indican su fecha y los fallos u omisiones; no se convierten en supuestas aportaciones de estudiantes.

Antes de la entrega final, completa el déficit de entrenamiento, la revisión humana, los datos finales reservados y la demostración de todo el equipo. El panel y `ESTADO-RUBRICA.md` distinguen implementación, datos pendientes y evidencia por verificar.
