# Aportaciones reales del equipo

La página guarda aquí las consultas y los ejemplos nuevos de los compañeros A y B.
Esta carpeta se incluye en Git para que ambos puedan compartir sus aportaciones.

Cada registro ocupa un archivo distinto:

```text
alumno-a/queries/UUID.json       Consulta y respuesta, con hora real de guardado
alumno-b/examples/UUID.json      Ejemplo manual o revisión de una consulta
alumno-b/deletions/UUID.json     Retirada de un ejemplo, conservando su trazabilidad
```

`created_at` guarda el instante UTC del servidor. `timezone: America/Mexico_City`
indica cómo mostrarlo; la página presenta la fecha y la hora de Ciudad de México.
Los ejemplos revisados incluyen `source_query_id`, que enlaza la consulta original.
Los registros nuevos llevan `timestamp_kind: recorded`. Los ejemplos antiguos
migrados sin hora original conservan `created_at: null` y `timestamp_kind: unknown`.

Los quince días de `data/simulation.json` son un experimento inicial separado.
Sus fechas tienen `timestamp_kind: simulated` y no son fechas de trabajo real.

Antes del turno, recibe cambios con `recibir-aportes.cmd`. Después de guardar y
revisar las consultas, usa `subir-aportes.cmd`. Los modelos personalizados y el
estado de cada servidor permanecen en `data/local/`; cada integrante reentrena
su copia cuando recibe ejemplos nuevos. El registro de una consulta por sí solo
no la incorpora al entrenamiento: primero debe revisarse y etiquetarse.
