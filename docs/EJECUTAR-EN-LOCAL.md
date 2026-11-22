# Ejecutar el prototipo de YinYan Workshop en Windows

**Avance al 18 de noviembre de 2026.** Entrega final prevista: **4 de diciembre de 2026**. Cada integrante clona el mismo repositorio y ejecuta el servidor en su computadora. GitHub comparte los archivos; `127.0.0.1` o `localhost` identifican la computadora donde se abrió la aplicación.

## Preparar el entorno

1. Instala Git y clona el repositorio del equipo. Sigue [publicar-en-github.md](publicar-en-github.md) para la primera configuración.
2. Instala **Node.js 22 o Python 3.12** para abrir el servidor. Para entrenar, evaluar y regenerar documentos necesitas **Python y las dependencias del proyecto**.
3. Desde la raíz del proyecto instala las dependencias, si todavía no están disponibles:

   ```powershell
   py -3.12 -m pip install -r requirements-lock.txt
   ```

La carpeta actual incluye intérpretes en `runtime/`, pero están excluidos de Git. Si ya dispones de ese entorno, puedes conservarlo en la copia clonada. Los archivos `.cmd` lo buscan antes de utilizar los intérpretes instalados en el sistema. La instalación inicial puede necesitar internet; el chat y el entrenamiento posterior funcionan localmente con el entorno preparado.

## Abrir la aplicación

1. Abre **recibir-aportes.cmd** para recibir las aportaciones y versiones que el equipo haya enviado.
2. Haz doble clic en **iniciar.cmd** y deja abierta la consola.
3. Cuando aparezca el mensaje de servidor listo, abre **http://127.0.0.1:4173** si el navegador no se abrió.
4. Selecciona tu nombre: Erick Mendoza Mendoza, Daniel Gibran Luciano Tellez, Sergio Adriel Muñoz Camarena o Raynier Jetsahe Torres Flores.

El selector identifica al responsable de cada operación, sin autenticarlo. Erick y Daniel trabajan principalmente en datos; Sergio y Raynier en desarrollo, entrenamiento y evaluación. Las funciones completas están en [FLUJO-DE-TRABAJO.md](FLUJO-DE-TRABAJO.md).

El chatbot carga el modelo aprobado señalado por `data/training/active.json`. Una nueva jornada o una vista previa no lo reemplazan automáticamente. Si la página no puede verificar cuál es el modelo activo, muestra un error para reintentar.

No abras `web/index.html` directamente. No necesitas generar `dist/` para ejecutar el proyecto localmente. Cerrar la consola detiene el servidor.

## Incorporar ejemplos y crear jornadas

En **Ejemplos y entrenar**, guarda una expresión con su intención. También puedes usar **Preparar ejemplo** en Consultas. Ambos flujos crean un registro **Pendiente**, con identificador, responsable, fecha real y versión del dataset.

Revisa la pertinencia, la etiqueta, la diversidad y los duplicados. Aprueba o rechaza el registro; solo los aprobados se incorporan al entrenamiento. Puedes editar o retirar pendientes. Para cambiar un aprobado o rechazado, primero reábrelo como pendiente. Los registros y eventos quedan guardados al cerrar y volver a abrir la aplicación.

Pulsa **Entrenar modelo** para reservar una nueva jornada. Cada ejecución recibe número e identificador propios, incluso si hay varias en el mismo día. Se entrenan Naive Bayes y regresión logística con la misma representación TF-IDF y validación cruzada; el mayor F1 macro de validación determina el modelo seleccionado.

Una ejecución terminada genera una versión **Provisional**. En **Jornadas** revisa métricas, matrices, errores y comparación con la anterior. Puedes probarla sin activar; cuando corresponda, usa **Aprobar y activar**. La activación comprueba los artefactos y conserva versiones anteriores para recuperarlas. Si el entrenamiento falla, el modelo activo permanece disponible y la jornada conserva su estado de fallo.

También puedes iniciar una jornada desde una terminal:

```powershell
.\entrenar.cmd --author sergio
```

`entrenar.cmd` ejecuta `python -m src.training_runs start`; sin `--author`, registra el responsable técnico `system`. El comando crea una versión provisional, sin activarla.

## Dónde se guardan los archivos

| Ruta | Contenido |
| --- | --- |
| `data/team/` | Consultas, ejemplos y eventos de revisión con responsable y hora real. |
| `data/training/runs/UUID/` | Instantánea y resultados de cada jornada, ambos pipelines con sus vectorizadores y los modelos para el navegador. |
| `data/training/active.json` | Referencia de la versión aprobada activa. |
| `data/local/` | Cachés y estado propio del servidor, excluidos de Git. |

El servidor guarda `created_at` en UTC y la página muestra Ciudad de México, con formato de 24 horas. Los archivos recibidos por Git conservan sus fechas originales; hacer pull no crea consultas ni entrenamientos nuevos.

## Benchmark y prueba final

La base actual tiene 240 ejemplos y 16 intenciones, con 15 por categoría. **Faltan al menos cinco ejemplos aprobados por intención**; el panel Progreso calcula el déficit según las aportaciones existentes.

Las 80 consultas de `data/test.csv` son un benchmark conocido de desarrollo. La selección del modelo utiliza validación, no sus resultados. La prueba final va en **data/final-test.csv**, inicialmente vacío salvo la cabecera `text,intent`. Requiere al menos 50 consultas independientes reservadas. El procedimiento de evaluación registra su apertura y evita utilizar reiteradamente el mismo conjunto para comparar versiones nuevas. Los datos temporales de las pruebas del sistema no completan este requisito.

## Notebook, PDF y pruebas

Para documentar una jornada concreta utiliza su UUID, visible en Jornadas:

```powershell
.\reproducir-notebook.cmd --version UUID-DE-LA-JORNADA
.\generar-reporte.cmd --version UUID-DE-LA-JORNADA
```

`notebook.cmd` abre Jupyter. El notebook y el PDF deben describir la misma versión seleccionada, manteniendo los informes históricos separados. La fecha de corte del avance es el 18 de noviembre, sin afirmar que el proyecto haya concluido.

Para verificar desde una instalación con Node:

```powershell
node scripts/run-tests.mjs
node scripts/workflow-browser-check.mjs
```

En la copia con intérprete local, sustituye `node` por `.\runtime\node.exe`. La prueba de navegador requiere Chrome y crea datos y jornadas temporales. Los resultados de las comprobaciones se guardan en `reports/` con sus fechas de ejecución.

## Compartir el trabajo

Al comenzar usa `recibir-aportes.cmd`; al terminar, `subir-aportes.cmd`. Los ayudantes comparten **data/team/** y **data/training/**. Los cambios de código se confirman por separado. No hay envío automático al conversar y **pull recibe; push envía**.

Si recibes una nueva versión activa, recarga la página. Si recibes ejemplos aprobados, se incorporarán a la próxima jornada; recibirlos no modifica los modelos ya entrenados. Detén un entrenamiento antes de compartir sus archivos y coordina los turnos para evitar que dos personas cambien el modelo activo al mismo tiempo.

## Inicio sin el archivo de Windows

Desde la raíz ejecuta una de estas alternativas:

```powershell
node scripts/serve.mjs --open
```

```powershell
py -3.12 scripts/serve.py --open
```

El servidor Python usa la biblioteca estándar para servir la interfaz y los registros. Las operaciones de entrenamiento, evaluación y documentación necesitan las dependencias instaladas. GitHub e Instagram requieren conexión cuando se utilizan; la inferencia se ejecuta con el modelo local.

## Resolver problemas de inicio

| Situación | Qué hacer |
| --- | --- |
| El navegador no carga | Espera a que el servidor esté listo y usa la dirección impresa en la consola. |
| La consola se cerró | Vuelve a abrir `iniciar.cmd`. |
| Una consulta queda pendiente con el mensaje «Indica la versión de entrenamiento utilizada» | Recibe los cambios del repositorio, cierra la consola del servidor anterior y vuelve a abrir `iniciar.cmd`. Recarga la página y pulsa **Reintentar guardado**. |
| Falta un intérprete | Instala Node.js 22 o Python 3.12, o conserva el entorno `runtime/` disponible. |
| Faltan dependencias de entrenamiento | Instala `requirements-lock.txt` en el Python que utiliza el proyecto. |
| No se cargan los ejemplos y falta `training_history.json` | Recibe la versión completa con `git pull --ff-only` y reinicia `iniciar.cmd`. El catálogo y las referencias de `data/training/` deben estar incluidos en el repositorio. |
| Hay un error al cargar el modelo activo | Usa Reintentar; revisa que la jornada y sus archivos estén completos. No sustituyas el apuntador por una versión incompleta. |
| La jornada falló | Consulta su mensaje en Jornadas, corrige la causa e inicia otra ejecución; los modelos anteriores se conservan. |
| Otra aplicación ocupa el puerto | Revisa si ya existe una instancia abierta y sigue el mensaje del servidor. |
| Git no recibe o envía | Revisa conexión, permisos y mensaje de Git. Conserva tus registros locales. |

La configuración del repositorio debe realizarse antes del primer intercambio. Estas instrucciones no afirman que ya se haya publicado una URL en GitHub.

Las consultas pendientes se conservan en el navegador, incluso si abres otro clon
en la misma dirección local. Después de actualizar, las consultas de las etapas
de referencia se recuperan con su versión original, sin duplicarlas. Conserva los
datos del sitio mientras haya pendientes. Si una consulta pertenece a un modelo
anterior que no se puede identificar, permanecerá guardada en el navegador para
su revisión; las demás consultas recuperables pueden enviarse.

Si una copia perdió el catálogo o alguna referencia inicial, desde la raíz ejecuta
`node scripts/restore-training-catalog.mjs` (o `.\runtime\node.exe scripts/restore-training-catalog.mjs`
si usas el intérprete incluido). El comando recupera las quince referencias desde
los modelos y datos originales incluidos, sin entrenar otra jornada. Conserva el
modelo activo, las aportaciones y las jornadas reales; rechaza archivos existentes
que difieran de las referencias originales. Después reinicia el servidor y recarga
la página. Un clon completo ya incluye estos archivos y puede abrirse directamente.
