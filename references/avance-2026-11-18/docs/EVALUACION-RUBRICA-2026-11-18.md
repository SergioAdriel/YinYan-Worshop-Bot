# Evaluación de YinYan Workshop frente a la consigna

Fecha de corte: **18 de noviembre de 2026**. Fuente: consigna de Proyecto Final I facilitada por el responsable, con entrega indicada el 4 de diciembre. Esta revisión describe la versión actual de la plataforma y sus entregables; no es una calificación del docente.

## Dictamen

El prototipo funciona y cubre el dominio, el procesamiento de texto, la clasificación supervisada, el contexto y la interfaz. La actualización del notebook y del PDF alinea la documentación con los datos actuales y añade una comparación de dos clasificadores sobre el mismo conjunto. **Todavía hay requisitos pendientes antes de considerar completa la entrega.**

La consigna no exige quince días de actividad, una exactitud de 85 % ni una interfaz compleja. Exige datos suficientes por intención, un experimento comparable, resultados coherentes con el modelo integrado, una prueba independiente y comprensión del sistema por todos los integrantes.

## Los cinco criterios de la rúbrica

| Criterio | Estado observado | Evidencia y límite |
| --- | --- | --- |
| Dataset y PLN | Cumplimiento parcial | 240 ejemplos, 16 intenciones y 80 consultas adicionales. La base está balanceada, pero tiene **15 ejemplos por intención**, frente al mínimo de 20. Normalización, tokenización, stopwords, lematización ligera y TF-IDF funcionan en Python y JavaScript. |
| Dos modelos, comparación y selección | Comparación actual disponible; integración por cerrar | `src/current_experiment.py` compara Naive Bayes y regresión logística con CV estratificada de cinco pliegues y el mismo pipeline. Regresión logística gana por F1 macro de CV, mientras la página conserva Naive Bayes. Esa diferencia debe resolverse o justificarse con un criterio académico explícito antes de la entrega final. |
| Sistema conversacional | Cumple el funcionamiento básico | Conserva y utiliza equipo, falla y respuestas pendientes durante tres turnos. Maneja ambigüedad, desconocidos, reinicio y recuperación del parpadeo. El modo sencillo usa una respuesta fija en algunas intenciones aunque el gestor tenga tres plantillas; revisar el requisito de variantes. |
| Evaluación experimental | Métricas actuales completas; evaluación final por reservar | Notebook, PDF y JSON actuales incluyen accuracy, precision, recall, F1 macro, ambas matrices y análisis de errores observados. Las 80 consultas se han usado repetidamente como benchmark de desarrollo: se necesita una muestra nueva reservada para afirmar una evaluación final inédita después de seguir mejorando el bot. |
| Integración y documentación | Aplicación funcional; entrega formal por completar | Tres secciones: Chat, Consultas y Entrenar. Datos locales persistentes con autor y hora real, revisión humana y sincronización por Git. Notebook y PDF actualizados. La carpeta revisada no contiene `.git` ni acredita un repositorio publicado; faltan la URL de entrega y los nombres no proporcionados de los demás participantes. |

## Medición actual

Comparación recalculada con la base de 240 ejemplos y **cero aportaciones adicionales** presentes en `data/team/` al momento de esta revisión. Ambos modelos usan el mismo entrenamiento y las mismas 80 consultas para el benchmark. Los datos del experimento anterior de 384 ejemplos se conservan por separado y no se usan para estas cifras.

| Modelo | F1 macro medio de CV | Accuracy del benchmark | Precision macro | Recall macro | F1 macro del benchmark |
| --- | ---: | ---: | ---: | ---: | ---: |
| Naive Bayes, activo | 41.72 % | 86.25 % (69/80) | 88.11 % | 86.25 % | 86.00 % |
| Regresión logística, candidato | 45.62 % | 87.50 % (70/80) | 89.53 % | 87.50 % | 87.34 % |

La selección se calcula con validación cruzada, no con el resultado de las 80 consultas. La diferencia entre CV y benchmark es amplia; el tamaño y la autoría sintética de los datos limitan la generalización. Una diferencia de un acierto en 80 mensajes tampoco demuestra por sí sola superioridad general.

Con los umbrales actuales, Naive Bayes acepta **29/80** consultas, todas correctas en este benchmark, y rechaza estadísticamente las otras 51. El **86.25 %** describe su etiqueta más probable en los 80 mensajes; no significa que responda directamente bien al 86.25 % de cualquier conversación. La cobertura es **36.25 %**. El gestor puede pedir aclaraciones y continuar a partir de las elecciones del usuario.

## Pendientes por prioridad

1. **Añadir al menos 80 ejemplos pertinentes y revisados:** cinco por cada una de las 16 intenciones. No basta con añadir 80 frases sin comprobar su distribución; evitar duplicados y variaciones triviales. Repetir el experimento después.
2. **Cerrar la selección e integración del modelo:** integrar el elegido mediante validación o explicar y evaluar una razón técnica para conservar otro. La documentación distingue ambos estados y no sustituye ese paso.
3. **Reservar una nueva prueba final:** al menos 50 consultas adicionales que no se utilicen para ajustar ejemplos, umbrales ni selección. Durante el desarrollo utilizar validación y el benchmark ya conocido.
4. **Revisar tres variantes por intención cuando corresponda:** el modo sencillo actualmente elimina algunas variaciones disponibles en las plantillas.
5. **Completar la entrega formal:** repositorio GitHub, nombres reales y funciones de los integrantes, revisión humana del corpus y práctica de defensa de todos los componentes. La distribución propuesta de cuatro perfiles no acredita participación histórica.

## Verificación realizada

- **69/69 pruebas automáticas** pasaron durante esta revisión: clasificación exportada, gestor, recuperación, servidores Node/Python, persistencia y ayudantes de Git.
- **7/7 comprobaciones adicionales** pasaron con el modelo base que usa la página y `concise: true`. Incluyen tres turnos, ambigüedad, tema ajeno, parpadeo, líquido y reinicio. Se registraron seis expresiones exploratorias ausentes del entrenamiento tras tokenización; no constituyen una estimación general de exactitud.
- La curva de quince etapas se recalculó con sus ejemplos acumulados y coincide con los artefactos entregados. Las fechas reales de las consultas no se reescribieron.

Pasar estas pruebas no demuestra por sí solo el cumplimiento de todos los apartados académicos ni sustituye la demostración con preguntas nuevas del profesor.

## Evidencia principal

- [Notebook actualizado](../notebooks/experimentacion.ipynb).
- [Reporte técnico actualizado](reporte-tecnico.pdf) y [versión en texto](reporte-tecnico.md).
- [Resultados completos actuales](../reports/current-experiment.json).
- [Diálogos actuales y comprobaciones](../reports/current-dialogue-results.json).
- [Matriz de Naive Bayes](../reports/current-confusion-naive_bayes.png) y [matriz de regresión logística](../reports/current-confusion-logistic_regression.png).
- [Trazabilidad de requisitos](trazabilidad.md), [dominio e intenciones](dominio-e-intenciones.md) y [guía de repositorio compartido](publicar-en-github.md).
