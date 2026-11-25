# YinYan Workshop

Chatbot local de soporte técnico informático y práctica de aprendizaje supervisado. Entrega final prevista para el **4 de diciembre de 2026**.

La plataforma permite consultar al bot, guardar expresiones, revisar sus categorías y producir nuevas jornadas de entrenamiento. **Sergio Adriel Muñoz Camarena es el desarrollador principal.**

## Equipo y responsabilidades

| Integrante | Área y responsabilidades indicadas por el equipo |
| --- | --- |
| Erick Mendoza Mendoza | Datos: elaboración e incorporación de ejemplos, expresiones lingüísticas, clasificación por intención y revisión. |
| Daniel Gibran Luciano Tellez | Datos: ejemplos, organización del conjunto, revisión de etiquetas y diversidad de expresiones. |
| Sergio Adriel Muñoz Camarena | Desarrollo principal: programación del chatbot, sistema conversacional, integración e interfaz. |
| Raynier Jetsahe Torres Flores | Desarrollo: integración, entrenamiento, evaluación y comparación de clasificadores, verificación. |

El selector de responsable atribuye cada operación a la persona seleccionada. El proyecto funciona como herramienta local del equipo y el selector no autentica a sus integrantes.

## Abrir el proyecto

Haz doble clic en **iniciar.cmd** y conserva abierta la consola. La dirección habitual es **http://127.0.0.1:4173**. Usa el servidor local; no abras `web/index.html` directamente.

Cada integrante ejecuta su copia del repositorio. `iniciar.cmd` busca primero los intérpretes locales y después los instalados en Windows. Para el servidor usa Node.js 22 o Python 3.12. **El entrenamiento y los documentos requieren Python y las dependencias de `requirements-lock.txt`**. [Instalación en Windows](docs/EJECUTAR-EN-LOCAL.md) · [Configuración de GitHub](docs/publicar-en-github.md)

## Cómo leer el código

| Archivo | Responsabilidad |
| --- | --- |
| [web/app.js](web/app.js) | Envía el mensaje al diálogo, muestra la respuesta, guarda la consulta y abre el mapa bajo **Esta consulta**. |
| [web/dialogue.js](web/dialogue.js) | Mantiene el equipo, el problema y la pregunta pendiente. Detecta alertas y elige el siguiente paso. |
| [web/ml.js](web/ml.js) | Calcula TF-IDF y ejecuta el modelo exportado en el navegador. En Random Forest recorre los árboles y promedia las probabilidades de sus hojas. |
| [scripts/serve.mjs](scripts/serve.mjs) y [scripts/serve.py](scripts/serve.py) | Sirven la interfaz y la API local. |
| [scripts/team-store.mjs](scripts/team-store.mjs) y [scripts/team_store.py](scripts/team_store.py) | Guardan consultas y aportes. Reconstruyen el estado de cada ejemplo a partir de su registro original y sus eventos de revisión. |
| [src/training_runs.py](src/training_runs.py) | Congela los ejemplos aprobados, entrena, verifica la paridad Python–JavaScript y registra las activaciones. |

Para seguir un caso completo, escribe «Mi laptop no enciende» y responde «Solo vibra». El diálogo conserva el problema de encendido y pasa a comprobar si hay imagen. Una pregunta posterior como «¿Tiene una luz?» mantiene esa etapa. Para un seguimiento reconocido, el clasificador recibe los mensajes del usuario del caso en curso. Abre **Ver mapa de decisiones** después de cada turno para inspeccionar la entrada, los umbrales, las rutas de los árboles y el paso del diálogo.

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
5. Pulsa **Entrenar modelo**. Se crea una jornada con UUID, número consecutivo, fecha real e instantánea del dataset. Se comparan Naive Bayes, regresión logística y Random Forest con el mismo TF-IDF y cinco pliegues estratificados. Las jornadas nuevas seleccionan Random Forest y registran por separado el ganador por F1 macro medio. En el chat, el mapa de decisiones muestra los umbrales, las rutas de los árboles y el resultado del diálogo.
6. En **Jornadas**, revisa las métricas, matrices, errores y comparación con la anterior. La versión nueva queda **Provisional**. La vista previa no cambia el modelo activo.
7. Activa la versión cuando corresponda. El servidor comprueba los artefactos antes del cambio y conserva las anteriores para recuperarlas. Una jornada fallida no aparece como completada ni reemplaza la activa.
8. Consulta **Progreso** y, al terminar el turno, abre **subir-aportes.cmd** para compartir las aportaciones y las jornadas por Git.

Consultar no entrena automáticamente y las respuestas del bot no se convierten por sí solas en etiquetas verdaderas. La detección de duplicados léxicos no sustituye la revisión humana de diversidad.

## Modelo y evaluación

La base de arranque contiene **240 ejemplos y 16 intenciones**. La jornada 11 usó **448 ejemplos**, incluidos 208 aportes aprobados. **Progreso** calcula lo que falta por intención con los aportes de la copia que se está usando.

La jornada 11 seleccionó **Random Forest** para el chat y registró **51 de 80 aciertos** en desarrollo. En esa misma jornada, regresión logística acertó **69 de 80** y obtuvo el mejor F1 macro en validación cruzada. **Jornadas** muestra la versión activa de la copia local y sus métricas.

`data/test.csv` conserva 80 consultas sintéticas ya conocidas como **benchmark de desarrollo**. No se usan para ajustar el clasificador ni para elegirlo por sus resultados. **La prueba final independiente sigue pendiente de datos:** `data/final-test.csv` contiene solo la cabecera `text,intent`; requiere al menos 50 consultas adicionales reservadas. Su evaluación es explícita y registra la apertura para evitar reutilizar esa misma prueba al comparar nuevas versiones.

El porcentaje no está fijado en 85 % ni garantiza mejoras cada vez que se entrena. El sistema clasifica consultas y ofrece orientación básica; no confirma componentes dañados ni reparaciones exitosas. Revisa [ESTADO-RUBRICA.md](ESTADO-RUBRICA.md) para distinguir requisitos verificados, datos pendientes y verificaciones todavía necesarias.

## Qué se conserva y comparte

| Ruta | Contenido |
| --- | --- |
| `data/team/` | Consultas, ejemplos y eventos de edición, revisión y retirada por responsable. Incluyen UUID, autor, hora real y versión del dataset. |
| `data/training/runs/UUID/` | Instantánea, manifiesto de jornada, pipelines con sus vectorizadores, modelos para navegador, métricas, matrices, predicciones y errores. |
| `data/training/active.json` | Apuntador a la versión aprobada activa; las activaciones conservan su trazabilidad. |
| `data/local/` | Cachés y estado de ejecución del servidor. |
| `references/captura/` | Copia recuperable anterior a esta ampliación, con hashes y fechas originales. |

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
