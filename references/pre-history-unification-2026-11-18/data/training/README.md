# Jornadas y modelos del equipo

Esta carpeta conserva el historial nuevo del prototipo y se comparte por Git.
Una jornada se crea únicamente al ejecutar realmente un entrenamiento. Sus
identificadores y fechas no se reconstruyen a partir de la curva de referencia.

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

Las pruebas automáticas usan `YINYAN_DATA_DIR` dentro de Temp para aislar su
historial del proyecto; `YINYAN_TRAINING_DIR` permite configurar una ubicación
específica. `data/local/` conserva únicamente estado y cachés propios del servidor.
