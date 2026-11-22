# Prototipo funcional — Avance al 18 de noviembre de 2026

**YinYan Workshop · Chatbot de soporte técnico informático.** Entrega final prevista: **4 de diciembre de 2026**. Este corte documenta un prototipo funcional preparado para seguir incorporando datos; no representa la conclusión definitiva del proyecto.

La plataforma permite consultar al bot, guardar expresiones, revisar sus categorías y producir nuevas jornadas de entrenamiento. **Sergio Adriel Muñoz Camarena es el desarrollador principal.**

## Equipo y responsabilidades

| Integrante | Área y responsabilidades indicadas por el equipo |
| --- | --- |
| Erick Mendoza Mendoza | Datos: elaboración e incorporación de ejemplos, expresiones lingüísticas, clasificación por intención y revisión. |
| Daniel Gibran Luciano Tellez | Datos: ejemplos, organización del conjunto, revisión de etiquetas y diversidad de expresiones. |
| Sergio Adriel Muñoz Camarena | Desarrollo principal: programación del chatbot, sistema conversacional, integración e interfaz. |
| Raynier Jetsahe Torres Flores | Desarrollo: integración, entrenamiento, evaluación y comparación de clasificadores, verificación. |

El selector de responsable registra quién realiza una operación; **no es autenticación ni control seguro de acceso por roles**. Las fechas y cantidades individuales proceden de los registros guardados. La asignación de funciones no inventa sesiones pasadas.

## Abrir el proyecto

Haz doble clic en **iniciar.cmd** y conserva abierta la consola. La dirección habitual es **http://127.0.0.1:4173**. Usa el servidor local; no abras `web/index.html` directamente.

Cada integrante clona el repositorio de GitHub y lo ejecuta en su computadora. La carpeta actual dispone de intérpretes en `runtime/`, excluidos de Git. En otra computadora instala Node.js 22 o Python 3.12 para el servidor; **el entrenamiento y los documentos requieren Python y `requirements-lock.txt`**. Consulta [instalación en Windows](docs/EJECUTAR-EN-LOCAL.md) y [configuración del repositorio](docs/publicar-en-github.md).

El repositorio debe incluir `data/training/training_history.json` y las quince
referencias importadas de `data/training/runs/`: son necesarias para cargar y
validar ejemplos desde un clon nuevo. Si una copia está incompleta, recibe los
cambios del equipo; también puedes reconstruir esas referencias originales con
`node scripts/restore-training-catalog.mjs`. Consulta la [recuperación del catálogo](docs/EJECUTAR-EN-LOCAL.md#resolver-problemas-de-inicio).

## Flujo habitual

1. Abre **recibir-aportes.cmd** para recibir los cambios del equipo y después `iniciar.cmd`.
2. Selecciona tu nombre. En **Chat** haz consultas; el texto y la respuesta se guardan con responsable, modelo, sesión y hora real de Ciudad de México.
3. En **Ejemplos y entrenar** agrega una expresión y su intención. También puedes preparar un ejemplo desde **Consultas**. El registro empieza **Pendiente**.
4. Revisa pertinencia, etiqueta, diversidad y duplicados. Aprueba o rechaza. Solo los **Aprobados** entran en la próxima jornada. Los pendientes pueden editarse o retirarse; para modificar un aprobado o rechazado, primero reábrelo.
5. Pulsa **Entrenar modelo**. Se crea una jornada con UUID, número consecutivo, fecha real e instantánea del dataset. Se comparan Naive Bayes y regresión logística con el mismo TF-IDF y cinco pliegues estratificados; gana el F1 macro medio de validación.
6. En **Jornadas**, revisa las métricas, matrices, errores y comparación con la anterior. La versión nueva queda **Provisional**. La vista previa no cambia el modelo activo.
7. Activa la versión cuando corresponda. El servidor comprueba los artefactos antes del cambio y conserva las anteriores para recuperarlas. Una jornada fallida no aparece como completada ni reemplaza la activa.
8. Consulta **Progreso** y, al terminar el turno, abre **subir-aportes.cmd** para compartir las aportaciones y las jornadas por Git.

Consultar no entrena automáticamente y las respuestas del bot no se convierten por sí solas en etiquetas verdaderas. La detección de duplicados léxicos no sustituye la revisión humana de diversidad.

## Estado del corte y datos pendientes

La base actual contiene **240 ejemplos, 16 intenciones y 15 ejemplos por intención**. Al corte documentado no hay ejemplos adicionales aprobados: **faltan 80 ejemplos pertinentes, cinco por cada categoría**, para alcanzar el mínimo de veinte. El panel recalcula el déficit con los aportes posteriores.

La jornada de referencia realmente ejecutada es la **jornada 1**, identificador `861484ac-3558-43d4-a997-959aeec83d47`. Selecciona **regresión logística** por validación y está activa en este corte. Obtiene **70/80 aciertos (87.50 %)** y **F1 macro de 87.34 %** en el benchmark de desarrollo. Los umbrales aceptan 54 de sus 80 consultas; cobertura y accuracy son medidas diferentes. El modelo activo posterior siempre se consulta en **Jornadas**, no se deduce de esta descripción histórica.

`data/test.csv` conserva 80 consultas sintéticas ya conocidas como **benchmark de desarrollo**. No se usan para ajustar el clasificador ni para elegirlo por sus resultados. **La prueba final independiente sigue pendiente de datos:** `data/final-test.csv` contiene solo la cabecera `text,intent`; requiere al menos 50 consultas adicionales reservadas. Su evaluación es explícita y registra la apertura para evitar reutilizar esa misma prueba al comparar nuevas versiones.

El porcentaje no está fijado en 85 % ni garantiza mejoras cada vez que se entrena. El sistema clasifica consultas y ofrece orientación básica; no confirma componentes dañados ni reparaciones exitosas. Revisa [ESTADO-RUBRICA.md](ESTADO-RUBRICA.md) para distinguir requisitos verificados, datos pendientes y verificaciones todavía necesarias.

## Qué se conserva y comparte

| Ruta | Contenido |
| --- | --- |
| `data/team/` | Consultas, ejemplos y eventos de edición, revisión y retirada por responsable. Incluyen UUID, autor, hora real y versión del dataset. |
| `data/training/runs/UUID/` | Instantánea, manifiesto de jornada, ambos pipelines con sus vectorizadores, modelos para navegador, métricas, matrices, predicciones y errores. |
| `data/training/active.json` | Apuntador a la versión aprobada activa; las activaciones conservan su trazabilidad. |
| `data/local/` | Cachés y estado propio del servidor, excluidos de Git. |
| `references/avance-2026-11-18/` | Copia recuperable anterior a esta ampliación, con hashes y fechas originales. |

`subir-aportes.cmd` confirma **data/team/** y **data/training/** y hace push; los cambios de código se confirman por separado. `recibir-aportes.cmd` hace pull. No hay sincronización automática al escribir. Si recibes una nueva versión activa, recarga la página para cargarla; si recibes ejemplos aprobados, se usarán en la siguiente jornada.

La base histórica de quince etapas conserva su procedencia sintética en el apartado secundario de Consultas y en [su metodología](docs/SIMULACION.md). Esas etapas no se convierten en jornadas reales ni se atribuyen como sesiones históricas del equipo. `web/model.json`, `reports/metrics.json` y `models/` corresponden al experimento anterior de 384 ejemplos y se mantienen como referencia separada.

## Entrenar y reproducir documentos

`entrenar.cmd` crea una nueva jornada provisional. Para registrar un responsable desde consola:

```powershell
.\entrenar.cmd --author sergio
```

Sin responsable explícito, el comando registra la ejecución como `system`, no como una sesión de un estudiante. También puedes usar la página con tu nombre seleccionado.

El [notebook](notebooks/experimentacion.ipynb) y el [PDF](docs/reporte-tecnico.pdf) deben describir la misma versión seleccionada. Para una jornada concreta:

```powershell
python -m src.current_experiment --version UUID-DE-LA-JORNADA
node scripts/check-current-dialogue.mjs --version UUID-DE-LA-JORNADA
python -m src.create_notebook --version UUID-DE-LA-JORNADA
python scripts/generate-report.py --version UUID-DE-LA-JORNADA
```

En la copia con intérpretes locales, sustituye `python` por `.\runtime\python\python.exe` y `node` por `.\runtime\node.exe`. `reproducir-notebook.cmd --version UUID-DE-LA-JORNADA` y `generar-reporte.cmd --version UUID-DE-LA-JORNADA` ofrecen el mismo flujo en Windows. `notebook.cmd` abre el editor Jupyter.

## Comprobar el funcionamiento

```powershell
node scripts/run-tests.mjs
node scripts/workflow-browser-check.mjs
```

La segunda comprobación necesita Chrome y utiliza datos y jornadas temporales; no añade ejemplos al corpus del equipo. Los resultados guardados indican sus fechas reales y cualquier fallo u omisión. El procedimiento completo está en [FLUJO-DE-TRABAJO.md](docs/FLUJO-DE-TRABAJO.md) y el resumen de la ampliación en [RESUMEN-CAMBIOS.txt](RESUMEN-CAMBIOS.txt).
