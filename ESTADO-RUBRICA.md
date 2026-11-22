# Prototipo funcional — Avance al 18 de noviembre de 2026

Entrega final prevista: **4 de diciembre de 2026**. Esta matriz distingue infraestructura comprobada, datos pendientes y verificaciones de entrega; no declara terminado el proyecto.

Estados: **Cumplido**, **Pendiente de datos**, **Pendiente de verificación**, **No cumplido**.

| Requisito | Estado | Evidencia |
| --- | --- | --- |
| Dominio único y delimitado, opción B | Cumplido | docs/dominio-e-intenciones.md: soporte de computadoras, celulares y consolas. |
| Diez intenciones con significado y acciones | Cumplido | 16 intenciones en data/simulation.json y docs/dominio-e-intenciones.md. |
| Doscientos ejemplos de entrenamiento | Cumplido | 240 muestras de base y aportaciones aprobadas. |
| Veinte ejemplos por intención | Pendiente de datos | Faltan 80 ejemplos aprobados; tabla por intención más abajo. |
| Procedencia y datos estructurados | Cumplido | JSON/CSV; base sintética identificada y eventos reales nuevos en data/team/. |
| Diversidad y revisión humana de los ejemplos nuevos | Pendiente de datos | Flujo de revisión implementado; completar y revisar las expresiones que faltan. |
| Ausencia de duplicados y etiquetas contradictorias | Cumplido | Tokenización compartida y rechazo de coincidencias con base, benchmark y prueba final; tests/example-review.test.mjs. |
| Prueba final independiente de al menos 50 consultas | Pendiente de datos | data/final-test.csv: 0 consultas; benchmark conocido separado de 80 mensajes. |
| Normalización, limpieza y caracteres especiales | Cumplido | src/preprocessing.py; web/ml.js; pruebas de paridad. |
| Tokenización y lematización ligera | Cumplido | Diccionario explícito, negación conservada y mismo proceso en entrenamiento e inferencia. |
| TF-IDF ajustado dentro de cada partición | Cumplido | Pipeline unigramas/bigramas, frecuencia sublineal y normalización L2. |
| Dos clasificadores supervisados propios | Cumplido | Naive Bayes y regresión logística por jornada; pipelines guardados con joblib. |
| Validación comparable y selección justificada | Cumplido | Cinco pliegues estratificados, semilla 42 y máximo F1 macro; benchmark y prueba final no eligen el modelo. |
| Vectorizador y clasificador almacenados | Cumplido | data/training/runs/<UUID>/: ambos pipelines y exportaciones JSON verificadas. |
| Accuracy, precision, recall y F1 macro | Cumplido | run.json y las dos tablas de modelos de cada jornada. |
| Dos matrices de confusión | Cumplido | JSON y figuras confusion-*.png dentro de cada jornada. |
| Tres errores reales interpretados, cuando existen | Cumplido | Errores observados en run.json, notebook y PDF; no se fabrican si hay menos. |
| Clasificación automática y respuestas coherentes | Cumplido | web/ml.js; web/dialogue.js; comprobación funcional de la versión aprobada. |
| Tres variantes de respuesta cuando corresponde | Cumplido | Modo sencillo conserva variantes sociales y orientaciones; tests/concise.test.mjs. |
| Contexto efectivo durante tres turnos | Cumplido | Equipo, falla y respuestas pendientes modifican el siguiente mensaje y el resumen. |
| Ambigüedad, desconocidos y temas ajenos | Cumplido | Aclaración incluso con clasificación confiada de una frase sin síntoma; recuperación guiada. |
| Reinicio del contexto | Cumplido | Nueva consulta y comando explícito de reinicio; historial y estado de conversación reiniciados. |
| Interfaz web funcional y móvil | Cumplido | reports/test-results.json; tests/; reports/workflow-browser-results.json |
| Guardar ejemplos antes del entrenamiento | Cumplido | UUID, autor, hora, estado y versión; eventos inmutables y persistencia tras reinicio. |
| Pendiente, aprobado y rechazado | Cumplido | Edición/retiro de pendientes y reapertura controlada de revisados; solo aprobados se entrenan. |
| Jornadas reales y numeración automática | Cumplido | Reserva exclusiva, ID único, instante UTC real y estado failed si no termina. |
| Modelos provisional, activo e histórico | Cumplido | Activación explícita, validación de artefactos y recuperación de versiones anteriores. |
| Comparación con entrenamiento anterior | Cumplido | Métricas y diferencias por jornada, sin forzar mejora ni reemplazo automático. |
| Panel de progreso y cumplimiento | Cumplido | Conteos, distribución, faltantes, versiones, fecha y estados basados en evidencia. |
| Evaluación final preparada y protegida | Cumplido | Acción explícita; mínimo 50, separación de datos y recibo semántico que impide reutilizar la prueba para comparar otra versión. |
| Cuatro responsables consistentes | Cumplido | docs/equipo.json y selector: Erick, Daniel, Sergio y Raynier; no se afirma autenticación por roles. |
| Repositorio compartible con instalación Windows | Cumplido | README, .cmd, requirements-lock.txt y ayudantes Git probados con dos clones temporales. |
| Notebook ejecutable de la versión elegida | Cumplido | notebooks/experimentacion.ipynb; --version; CV y métricas reproducidas con su instantánea. |
| PDF de máximo ocho cuartillas principales | Cumplido | docs/reporte-tecnico.pdf: 7 páginas principales; hashes en docs/pdf-verification.json. |
| Referencia anterior conservada | Cumplido | references/avance-2026-11-18/REFERENCE.json y copia recuperable de 119 archivos. |
| URL del repositorio GitHub entregada al profesor | Pendiente de verificación | Configuración preparada; no se proporcionó una URL de repositorio para verificar publicación o entrega. |
| Defensa y comprensión de todos los integrantes | Pendiente de verificación | Guía de demostración disponible; la presentación en vivo corresponde al equipo. |

## Distribución del dataset

| Intención | Base | Aprobados con base | Pendientes | Rechazados | Faltan para 20 |
| --- | ---: | ---: | ---: | ---: | ---: |
| saludo | 15 | 15 | 0 | 0 | 5 |
| despedida | 15 | 15 | 0 | 0 | 5 |
| ayuda | 15 | 15 | 0 | 0 | 5 |
| encendido | 15 | 15 | 0 | 0 | 5 |
| carga | 15 | 15 | 0 | 0 | 5 |
| temperatura | 15 | 15 | 0 | 0 | 5 |
| rendimiento | 15 | 15 | 0 | 0 | 5 |
| conexion | 15 | 15 | 0 | 0 | 5 |
| pantalla | 15 | 15 | 0 | 0 | 5 |
| sonido | 15 | 15 | 0 | 0 | 5 |
| almacenamiento | 15 | 15 | 0 | 0 | 5 |
| software | 15 | 15 | 0 | 0 | 5 |
| controles | 15 | 15 | 0 | 0 | 5 |
| liquidos | 15 | 15 | 0 | 0 | 5 |
| presupuesto | 15 | 15 | 0 | 0 | 5 |
| contacto | 15 | 15 | 0 | 0 | 5 |

Faltan **80 ejemplos aprobados de entrenamiento** y **50 consultas de prueba final**. No se generaron muestras para aparentar cumplimiento.

## Verificación del avance

Suite de pruebas: 97/97 aprobadas, 0 fallidas, 0 omitidas.
Navegador: 12 comprobaciones aprobadas y 0 fallidas; jornadas de QA aisladas en Temp.

Modelo activo: **logistic_regression**, jornada **1**, UUID `861484ac-3558-43d4-a997-959aeec83d47`.
Ejecución real: `2026-11-18T19:00:38.991Z` a `2026-11-18T19:00:45.060Z`; responsable `system`.
Benchmark conocido: 70/80 aciertos (87.50 %), F1 macro 87.34 %. Se seleccionó por validación cruzada, no por estas cifras.

Las pruebas del sistema verifican componentes y flujos; no sustituyen la revisión lingüística, la nueva prueba reservada ni la demostración con preguntas del docente.
