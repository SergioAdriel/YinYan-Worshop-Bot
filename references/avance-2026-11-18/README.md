# YinYan Workshop · Bot del equipo

**Desarrollador principal: Sergio Adriel Muñoz Camarena.**

Desarrollé esta plataforma local de soporte técnico para que mis compañeros pudieran participar en el entrenamiento de un modelo de clasificación de consultas. La herramienta permite hacer preguntas al bot, revisar sus respuestas, corregir errores y guardar ejemplos etiquetados para volver a entrenarlo.

## Propósito y participación del equipo

Mi función como desarrollador principal es construir y mantener la plataforma que facilita el trabajo del equipo. Mis compañeros participan aportando consultas y ejemplos, revisando las categorías correctas y probando el comportamiento del modelo después de cada entrenamiento.

La distribución de funciones contempla **cuatro perfiles: dos de desarrollo y dos de aportación y revisión de datos**. Sergio Adriel Muñoz Camarena figura como desarrollador principal. Los nombres de los otros integrantes deben completarse con los de quienes participen; los identificadores A/B permiten registrar sus aportaciones en la plataforma. Esta organización no sustituye la evidencia de trabajo guardada.

La plataforma está preparada para que dos compañeros trabajen por turnos como **Compañero A** y **Compañero B**. Cada aportación nueva se guarda con su autor, fecha y hora real. Los archivos se comparten mediante GitHub para que ambos puedan continuar el trabajo desde sus propias computadoras.

El objetivo es observar cómo cambia el resultado del modelo al incorporar ejemplos revisados. Hacer consultas permite detectar fallas; revisar y etiquetar esas consultas genera material de entrenamiento. El porcentaje de aciertos se calcula al entrenar y puede subir, mantenerse o bajar según los datos aportados.

## Abrir

Haz doble clic en **iniciar.cmd** y conserva abierta su consola. La dirección habitual es **http://127.0.0.1:4173**. La carpeta actual incluye Node.js y Python con dependencias en runtime/. No abras web/index.html directamente.

Cada compañero debe clonar el repositorio de GitHub. Los intérpretes no se incluyen en Git: necesitas Node.js o Python para abrir el servidor, y Python con requirements-lock.txt para reentrenar. La instalación se explica en [docs/EJECUTAR-EN-LOCAL.md](docs/EJECUTAR-EN-LOCAL.md).

## Trabajar por turnos

1. Antes de empezar, abre **recibir-aportes.cmd** para obtener los cambios de tu compañero.
2. Abre iniciar.cmd y elige **Compañero A** o **Compañero B**.
3. En **Chat**, haz consultas. Cada mensaje y su respuesta se guardan con autor, sesión, modelo y fecha/hora real de guardado.
4. En **Consultas**, elige **Usar para entrenar**. Revisa el texto, completa la falla si dependía de la conversación y elige la categoría correcta.
5. En **Entrenar**, agrega ejemplos manuales si lo necesitas y pulsa **Entrenar mi modelo**. Al terminar, pulsa **Probar mi modelo**.
6. Al terminar el turno, abre **subir-aportes.cmd** para confirmar los registros y enviarlos con Git. El compañero los recibirá al abrir **recibir-aportes.cmd** al empezar su siguiente turno.

Los dos archivos de sincronización requieren Git, una copia clonada del repositorio y permiso para subir cambios. La primera configuración se explica en [docs/publicar-en-github.md](docs/publicar-en-github.md). No se hace ningún envío automático a GitHub desde el chat.

## Qué se guarda

Las aportaciones reales están en **data/team/**, organizadas por compañero. Cada consulta o ejemplo ocupa un archivo distinto, para reducir conflictos entre los cambios de ambos integrantes.

- Las consultas guardan texto, respuesta, autor, sesión, modelo e instante de guardado.
- Los ejemplos guardan texto, categoría, autor y su propio instante de creación.
- Los ejemplos revisados guardan source_query_id, que los enlaza con la consulta original.
- Retirar un ejemplo deja un registro de su retirada. La consulta original permanece en la bitácora.

La fecha created_at la asigna el servidor local en UTC al guardar. La página la presenta con fecha y hora de Ciudad de México, en formato de 24 horas. Elegir A o B identifica una aportación; no autentica a una persona. Los ejemplos antiguos migrados sin fecha original aparecen como «Sin fecha original»; no se les inventa una fecha de creación.

Si el servidor no puede guardar una consulta, la página muestra un aviso y conserva una copia pendiente en ese navegador para reintentar. Hasta que el guardado termine, esa consulta no está en data/team ni puede viajar con Git.

**Consultar no entrena automáticamente.** Primero hay que revisar y etiquetar el ejemplo. Las respuestas del propio bot no se añaden como verdades al entrenamiento.

## Entrenamiento y porcentaje

El modelo personalizado usa los 240 ejemplos iniciales y los ejemplos revisados o manuales del equipo. Cada entrenamiento vuelve a calcular los resultados con la prueba fija de 80 consultas. El porcentaje puede subir, mantenerse o bajar. No está fijado en 85 %.

El resultado mide acierto de clasificación, no reparaciones ni diagnósticos físicos. La precisión macro es otra medida. Los ejemplos con el mismo texto y categorías contradictorias deben revisarse antes de entrenar; si llegan al combinar aportes por Git, el entrenamiento avisa y conserva el modelo anterior.

Los modelos personalizados y el estado del servidor quedan en **data/local/**, excluidos de Git. Cuando recibes ejemplos nuevos, vuelve a entrenar en tu computadora para utilizarlos. Las aportaciones del equipo sí se comparten; el modelo ya cargado no cambia por recibir archivos hasta que lo entrenes y lo selecciones.

## Práctica inicial

En Consultas hay un apartado secundario con la **simulación inicial de quince días**. Dos perfiles aportan ejemplos y otros dos hacen pruebas. Sus fechas y horas están identificadas como simuladas, del 28 de octubre al 11 de noviembre de 2026. Se prepararon como escenario, no como registros de trabajo real.

Los quince modelos se entrenan de verdad con ejemplos acumulados: día 1, 16 ejemplos y 13/80 aciertos; día 15, 240 ejemplos y 69/80 aciertos (86.25 %). Las aportaciones nuevas de A y B llevan horas reales del servidor y se distinguen de ese escenario.

El método usa TF-IDF y Naive Bayes para clasificar, más respuestas breves con seguimiento. Puede pedir aclaraciones o derivar al taller cuando no entiende. El protocolo y los límites están en [docs/SIMULACION.md](docs/SIMULACION.md).

## Verificar y reproducir

entrenar.cmd regenera los quince modelos iniciales. El botón de la página entrena con las aportaciones propias. También puedes ejecutar:

```powershell
.\runtime\python\python.exe -m src.simulation --custom
.\runtime\node.exe --test tests/*.test.mjs
```

El notebook y el PDF tienen como fecha de corte el **18 de noviembre de 2026** y documentan la base actual de 240 ejemplos, las aportaciones presentes en `data/team/` y quince etapas acumulativas. Para repetir su comparación de Naive Bayes y regresión logística con los mismos datos:

```powershell
.\runtime\python\python.exe -m src.current_experiment
.\runtime\node.exe scripts/check-current-dialogue.mjs
.\runtime\python\python.exe -m src.create_notebook
.\runtime\python\python.exe scripts/generate-report.py
```

También puedes abrir **reproducir-notebook.cmd** y luego **generar-reporte.cmd**. Los resultados completos quedan en `reports/current-experiment.json`. El modelo desplegado sigue siendo Naive Bayes: el ganador de validación se informa por separado. La base tiene 15 ejemplos por intención; todavía faltan 5 por categoría para alcanzar el mínimo de 20 de la consigna. La prueba de 80 consultas es un benchmark de desarrollo conocido; una evaluación final inédita requiere otro conjunto reservado.

La comprobación opcional runtime\node.exe scripts\simulation-browser-check.mjs --train necesita Chrome. Usa datos temporales, comprueba el flujo de consultas y revisión, entrena una vez y guarda capturas en reports/.

## Repositorio compartido

GitHub se usa como repositorio compartido. Cada integrante ejecuta la aplicación en su computadora. GitHub Pages por sí solo no ejecuta el servidor que guarda consultas y entrena modelos: [documentación oficial](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).

El repositorio contiene código, datos iniciales y las aportaciones presentes en data/team/. runtime/ y data/local/ están excluidos de Git. La carpeta actual conserva los intérpretes para ejecutar sin instalar. Revisa las consultas que vas a compartir antes de subirlas al repositorio.

Guardar una consulta escribe su fecha y hora en tu copia local. **subir-aportes.cmd** la envía al repositorio y **recibir-aportes.cmd** la trae a la otra computadora, conservando su fecha original. Hacer pull no envía los registros propios. Si la página ya estaba abierta, actualiza la pestaña Consultas para ver los registros recibidos.

El [notebook](notebooks/experimentacion.ipynb) y el [PDF](docs/reporte-tecnico.pdf) describen la versión actual. `web/model.json`, `reports/metrics.json` y los modelos de `models/` se conservan como referencia del experimento anterior de 384 ejemplos. El chatbot actual usa `web/simulation/` y el modelo personalizado cuando lo seleccionas. Los resultados de ambos experimentos no deben mezclarse.

