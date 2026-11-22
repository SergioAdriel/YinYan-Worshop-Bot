# Jornadas y modelos del equipo

Esta carpeta conserva el historial nuevo del prototipo y se comparte por Git.
Una jornada se crea únicamente al ejecutar realmente un entrenamiento. Sus
identificadores y fechas no se reconstruyen a partir de la curva de referencia.

`training_history.json` es el catálogo oficial compartido. Sus quince referencias
iniciales se importan de `data/simulation.json`, `web/simulation/manifest.json`,
los modelos `web/simulation/day-XX.json` y el benchmark `data/test.csv`. Se
identifican mediante `run_type: imported_reference`, `reference_stage` y
`journey: 0`; conservan los ejemplos, las fechas simuladas y los modelos
originales. Son referencias de una simulación, no jornadas reales del equipo.
El catálogo y las carpetas a las que apunta deben incluirse en Git para que un
clon nuevo pueda cargar los ejemplos sin ejecutar un entrenamiento.

Si faltan estos archivos, ejecuta desde la raíz del proyecto:

```powershell
.\runtime\node.exe scripts/restore-training-catalog.mjs
```

También puedes usar `node scripts/restore-training-catalog.mjs` si tienes Node.js
instalado. La recuperación no requiere Python ni dependencias adicionales.
Valida todas las fuentes y los archivos existentes antes de escribir, utiliza
identificadores deterministas y publica el catálogo al final. Repetirla conserva
los mismos archivos; si encuentra una referencia distinta, se detiene sin
sobrescribirla. No modifica `active.json`, las aportaciones ni las jornadas reales.
Los metadatos incluyen la procedencia y los hashes SHA-256 de las fuentes.
`.gitattributes` conserva los bytes de los artefactos nuevos y fija los saltos de
línea de las fuentes históricas; así sus hashes también coinciden en clones con
`core.autocrlf` activado o desactivado. No cambies manualmente los saltos de línea
de un artefacto que ya tiene un hash registrado.

- `runs/<UUID>/run.json`: número, responsable, estado, datos, configuración y resultados.
- `runs/<UUID>/snapshot.json`: ejemplos congelados de esa jornada.
- `runs/<UUID>/*.joblib`: los dos pipelines y sus vectorizadores.
- `runs/<UUID>/*.json`: exportaciones al navegador, benchmark y artefactos verificables.
- `runs/<UUID>/*.png`: matrices de confusión.
- `runs/<UUID>/approvals/`: eventos de aprobación y activación.
- `active.json`: última versión aprobada seleccionada para el chatbot.

Las versiones nuevas son provisionales y las anteriores se conservan. Una
jornada fallida no sustituye el modelo activo. Para recuperar una versión
histórica, actívala desde la página; no edites el apuntador manualmente.

Antes de trabajar, recibe cambios del equipo. Al terminar, `subir-aportes.cmd`
confirma las aportaciones y el historial. Si ambos modifican el repositorio sin
recibir primero los cambios, resuelvan la divergencia de Git sin borrar registros.

Las pruebas del sistema usan `YINYAN_DATA_DIR` dentro de Temp para aislar su
historial del proyecto; `YINYAN_TRAINING_DIR` permite configurar una ubicación
específica. `data/local/` conserva únicamente estado y cachés propios del servidor.
