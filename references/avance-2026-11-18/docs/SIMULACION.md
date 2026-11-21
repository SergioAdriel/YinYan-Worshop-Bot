# Simulación local de quince días

Este ejercicio representa a **dos estudiantes ficticios que agregan ejemplos**
y **otros dos que hacen consultas de práctica**. Se creó de una vez con días
relativos del 1 al 15: no es una bitácora de quince días reales, ni atribuye
participación a personas reales.

Cada ejemplo y consulta inicial tiene `created_at`, `timezone` y
`timestamp_kind: "simulated"`. Sus horarios de escenario abarcan del 28 de octubre
al 11 de noviembre de 2026, en `America/Mexico_City` (UTC−06:00). El día incluye
`date`, `started_at` y `ended_at`. Esas horas se prepararon con los datos; no
documentan actividad realizada en esas fechas. Los registros reales que agreguen
ustedes se guardan por separado, con la hora actual del servidor.

Las faltas de ortografía, las abreviaciones y los acentos omitidos aparecen en
las entradas de los estudiantes. Los textos de respuesta del asistente se
mantienen con buena ortografía. No se agregan fallos aleatorios al bot: los
errores observados son los del clasificador entrenado con pocos ejemplos.

## Qué se entrena

Cada día añade 16 ejemplos (ocho por cada estudiante de entrenamiento), uno por
categoría. El día 1 contiene frases mínimas como «hola», «no prende» o «agua»;
el día 15 acumula 240 ejemplos con mayor variedad. Los dos compañeros de prueba
aportan una consulta de práctica diaria cada uno, 30 en total. Esas consultas
visibles no se incorporan al entrenamiento.

Se usa un único método fijado antes de abrir la evaluación: TF-IDF de palabras
y pares de palabras, frecuencia sublineal, normalización L2 y Multinomial Naive
Bayes con `alpha=0.25`. Todos los días tienen las 16 categorías. Los parámetros,
los umbrales y los hashes de datos están en
`reports/simulation-protocol.json`.

El modelo aprende a **clasificar consultas**, no a redactar respuestas nuevas
ni a diagnosticar componentes dañados. Las respuestas provienen de los textos
del proyecto. Conversar con el chat no añade automáticamente ejemplos: hay que
guardar ejemplos con su categoría correcta y reentrenar.

El gestor de diálogo también puede pedir una aclaración guiada: por ejemplo,
distinguir «se reinicia y sale el logo» de «solo parpadea la pantalla». Guarda
el dispositivo aunque el clasificador rechace una consulta técnica, reconoce
unas pocas variantes comunes como «ipone» y conserva la consulta en el resumen.
Las opciones elegidas por el usuario se registran como `resolution:user_choice`;
no se presentan como un acierto del clasificador. Tras intentos sin aclarar se
ofrece contacto con el taller. Esto evita repetir indefinidamente el mismo
mensaje sin volver perfecto el modelo ni cambiar la curva de la simulación.

## Medición observada

El conjunto fijo de evaluación es `data/test.csv`: 80 consultas sintéticas
independientes que ya pertenecían al proyecto, cinco por categoría. No se copia
ninguna de sus frases a los datos de entrenamiento, ni siquiera después de
normalizarlas. Los 15 modelos se entrenan antes de abrir sus frases y etiquetas.
No se seleccionan parámetros ni ejemplos usando sus resultados.

| Día | Ejemplos acumulados | Aciertos de clasificación |
| --- | ---: | ---: |
| 1 | 16 | 13/80 · 16,25 % |
| 5 | 80 | 44/80 · 55,00 % |
| 10 | 160 | 61/80 · 76,25 % |
| 15 | 240 | 69/80 · 86,25 % |

El objetivo aproximado era 85 %. **86,25 % es el resultado medido**, no una cifra
impuesta. La precisión macro del último día es 88,11 %. El acierto global es la
proporción de etiquetas correctas; la precisión macro promedia la precisión de
las categorías y puede dar una cifra diferente. Hay estancamientos y algunas
métricas pueden retroceder al agregar ejemplos.

La confianza de una predicción tampoco equivale al porcentaje de acierto. Se
conservan los umbrales del proyecto (`confidence=0.24`, `margin=0.045`,
`knownRatio=0.2`), fijados antes de evaluar. Con ellos, el modelo del día 15
acepta 29 de las 80 consultas de evaluación; en las demás solicita aclaración.
El 86,25 % describe la categoría más probable en **las 80 consultas**, incluso
cuando su confianza es insuficiente para responder directamente.

Son datos pequeños y sintéticos; estas cifras no predicen el resultado con
clientes reales. La prueba fija deja de servir como prueba final independiente
si se toman decisiones posteriores basadas en sus errores. Para afirmar una
mejora generalizable después de ajustes adicionales se necesita otra prueba.

## Reproducir

Desde la raíz del proyecto, en PowerShell:

```powershell
.\runtime\python\python.exe -m src.simulation
.\runtime\python\python.exe -m src.simulation --check
```

La primera orden genera los 15 modelos y el manifiesto bajo `web/simulation/`.
La segunda verifica los datos y vuelve a calcular las métricas. Ninguna modifica
`web/model.json`, los modelos originales, `data/train.csv`, `data/test.csv`,
`data/corpus.json` o `reports/metrics.json`.

Archivos del ejercicio:

- `data/simulation.json`: ejemplos, consultas y roles ficticios de cada día.
- `web/simulation/manifest.json`: contenido y resultados para la página local.
- `web/simulation/day-01.json` a `day-15.json`: modelos compatibles con `web/ml.js`.
- `reports/simulation-protocol.json`: método fijado y hashes de los datos.
- `reports/simulation-metrics.json`: curva completa y limitaciones.
- `reports/simulation-predictions.json`: predicción de las 80 consultas por día.
- `reports/simulation-parity.json`: referencias de probabilidades, tokens y
  aceptación para comprobar la equivalencia entre Python y JavaScript.

## Añadir ejemplos propios

El reentrenamiento local usa el último día simulado como base y agrega los
ejemplos que ustedes guarden. No reescribe el ejercicio de quince días. La página
guarda automáticamente las consultas con la respuesta y el modelo usado. Un
compañero revisa una consulta, elige su categoría y la convierte en ejemplo.
Después hay que pulsar **Entrenar**: conversar por sí solo no entrena el modelo.

Los nuevos ejemplos, consultas y bajas se guardan como archivos independientes:

```text
data/team/alumno-a/examples/<uuid>.json
data/team/alumno-a/queries/<uuid>.json
data/team/alumno-a/deletions/<uuid>.json
data/team/alumno-b/examples/<uuid>.json
data/team/alumno-b/queries/<uuid>.json
data/team/alumno-b/deletions/<uuid>.json
```

Cada alumno elige su identidad A o B antes de trabajar. Pueden alternarse por
fecha, subir sus archivos con Git y descargar los cambios del otro. GitHub
conserva los archivos e historial; no ejecuta el servidor de entrenamiento.
**GitHub Pages sirve la página estática, pero no puede guardar ni entrenar**:
cada compañero inicia el proyecto localmente desde su copia del repositorio.
No hay exportación ni importación manual de JSON en la interfaz.

Los archivos son inmutables: una baja añade un registro de eliminación; no
reescribe las aportaciones anteriores. Esto permite combinar aportaciones
distintas sin competir por un solo archivo de datos. Si quitan un ejemplo,
deben reentrenar para que cambie el modelo. El porcentaje se vuelve a calcular
y puede subir, bajar o mantenerse.

Cada registro real contiene `created_at` en UTC, `timezone: "America/Mexico_City"`
y `timestamp_kind: "recorded"`. La pantalla muestra la hora de México. La API
asigna esa fecha: no acepta fechas enviadas por el navegador. Un ejemplo
revisado incluye `source: "review"` y `source_query_id`, para relacionar la
consulta, la corrección humana y el siguiente entrenamiento. Una consulta
registra su autor, sesión, respuesta, categoría predicha, aceptación y modelo.
Los entrenamientos terminados incluyen `trained_at` real en su resultado.

El servidor migra los ejemplos antiguos de `data/local/student-examples.json`
sin borrar ese archivo. Como antes no se guardaba su hora, se marca
`created_at: null` y `timestamp_kind: "unknown"`; no se inventa una fecha.
`data/local/migration-complete.json` evita repetir la migración. Las predicciones,
el modelo propio y su estado de entrenamiento permanecen en `data/local/`.

Para herramientas por línea de comandos se conserva este formato de entrada:

```json
{
  "examples": [
    {
      "id": "ejemplo-propio-1",
      "text": "la compu de mi casa va lentisima al abrir fotos",
      "intent": "rendimiento",
      "author": "alumno-a"
    }
  ]
}
```

Se admiten hasta 500 ejemplos de 3 a 1200 caracteres, con identificadores únicos
y una de las categorías ya existentes. Cada ejemplo debe indicar su autor. Si
un ejemplo copia una consulta de la prueba fija tras normalizar, se rechaza el
reentrenamiento para evitar publicar una evaluación contaminada.

```powershell
.\runtime\python\python.exe -m src.simulation --custom --examples-file "C:\ruta\student-examples.json" --output-dir "C:\ruta\resultados"
```

Sin flags de rutas, se lee la bitácora de `data/team/`, se prepara una instantánea
en `data/local/training-input.json` y se entrena con los ejemplos vivos. Los
resultados `custom-model.json` y
`custom-result.json` se escriben junto al archivo de ejemplos, o en la carpeta
indicada por `--output-dir`. El servidor local sirve el modelo como
`/simulation/custom-model.json` desde su carpeta de datos. El resultado se puede
consultar mediante `GET /api/training` o leer en `custom-result.json` en disco.

`YINYAN_DATA_DIR` cambia la carpeta de ejecución y, en ese caso, la bitácora
predeterminada es `<YINYAN_DATA_DIR>/team-records/`. `YINYAN_TEAM_DIR` permite
elegir explícitamente otra carpeta compartida. Las rutas absolutas se resuelven
al iniciar el servidor. En uso normal no hace falta configurar variables.

`custom-result.json` identifica `simulated:false` para indicar que corresponde a
una ejecución local real, y `base_simulated:true` para conservar la procedencia
de los 240 ejemplos de base. Su evaluación sigue siendo sintética y de
desarrollo; no representa pruebas de clientes reales. Los ejemplos propios se
guardan aparte y no se atribuyen a los participantes ficticios de la simulación.
