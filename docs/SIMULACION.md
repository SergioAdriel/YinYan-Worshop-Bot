# Base inicial y curva de referencia

Este documento describe el conjunto sintético inicial, separado de las jornadas
nuevas del equipo. Para el flujo vigente de aprobación, entrenamiento y activación
consulta [FLUJO-DE-TRABAJO.md](FLUJO-DE-TRABAJO.md). El avance del proyecto tiene
fecha de corte del 18 de noviembre de 2026; la entrega final es el 4 de diciembre.

## Datos de partida

`data/simulation.json` contiene 240 ejemplos, 16 intenciones y quince etapas
acumulativas de 16 ejemplos. Sus perfiles de origen y 30 consultas de práctica
son sintéticos; no son aportaciones históricas atribuibles a Erick, Daniel,
Sergio o Raynier. La revisión humana de esos datos y de los nuevos ejemplos debe
acompañar su uso académico.

Los metadatos iniciales `timestamp_kind: simulated` y las fechas del 28 de octubre
al 11 de noviembre se conservan como procedencia del escenario. Las jornadas
nuevas se registran al ejecutarse, con UUID, número y hora real. La curva de
referencia no crea quince jornadas nuevas ni modifica registros del pasado.

## Método y resultados de referencia

Las quince etapas ajustan TF-IDF de unigramas/bigramas y Multinomial Naive Bayes
con alpha=0.25. Los ejemplos contienen algunas abreviaturas y errores de escritura;
las respuestas del bot conservan buena ortografía. No se agregan errores aleatorios.

| Etapa | Ejemplos acumulados | Aciertos del modelo de referencia |
| --- | ---: | ---: |
| 1 | 16 | 13/80 (16.25 %) |
| 5 | 80 | 44/80 (55.00 %) |
| 10 | 160 | 61/80 (76.25 %) |
| 15 | 240 | 69/80 (86.25 %) |

La evaluación usa las 80 consultas conocidas de `data/test.csv`, que ahora son
un benchmark de desarrollo. La exactitud de su clase más probable es distinta
de la cobertura de aceptación: Naive Bayes de la etapa 15 acepta 29 de 80 con
los umbrales iniciales. Estos números corresponden a esta referencia, no al
clasificador elegido en una jornada posterior.

## Reproducir la referencia

```powershell
python -m src.simulation --check
```

`python -m src.simulation` regenera únicamente los archivos de referencia.
No es el flujo normal de jornadas. El modo `--custom` se conserva por compatibilidad
y usa solo los ejemplos aprobados; no activa automáticamente su resultado.

Los archivos originales están en `web/simulation/` y `reports/simulation-*`.
La copia del avance anterior a la ampliación está en
`references/captura/`, con sus fechas y hashes intactos.

## Jornadas posteriores

El botón **Entrenar modelo** y `entrenar.cmd` ejecutan dos algoritmos, comparan
por validación cruzada y guardan una versión provisional en `data/training/`.
La selección no usa la prueba final reservada. La activación es explícita y
las versiones anteriores pueden recuperarse. Los aportes de `data/team/`
comienzan pendientes y solo los aprobados entran en una nueva jornada.

Las cifras vigentes están en el manifiesto de la jornada documentada,
`reports/current-experiment.json`, el notebook y el PDF. La clasificación,
la confianza, la cobertura y un diagnóstico físico son conceptos diferentes.
