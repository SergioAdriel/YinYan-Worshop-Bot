# Trazabilidad de los requisitos del profesor

Esta tabla permite localizar evidencia. La existencia de un archivo no sustituye la revisión de su contenido ni la demostración en vivo.

| Requisito | Implementación o evidencia |
| --- | --- |
| Elegir una temática y delimitar alcance | Opción B; `docs/dominio-e-intenciones.md` |
| Al menos 10 intenciones con significado y acciones | 16 etiquetas documentadas y utilizadas en datos, modelo y diálogo |
| Al menos 200 ejemplos y 20 por intención | Base actual: 240 ejemplos y 16 intenciones, pero 15 por categoría. Cumple total e intenciones; faltan 5 por categoría (80 ejemplos) para cumplir el mínimo por intención. `reports/current-experiment.json` calcula el déficit con las aportaciones existentes. |
| Prueba adicional de al menos 50 mensajes | Archivo independiente de prueba en `data/` |
| Diversidad y procedencia de datos | Documentación de `data/` y `docs/dominio-e-intenciones.md`; revisión del equipo pendiente de confirmar |
| Normalización, tokenización y limpieza | Módulo Python de preprocesamiento y su equivalente exportado en `web/ml.js` |
| Vectorización Bag of Words o TF-IDF | Pipeline TF-IDF ajustado sin datos de prueba |
| Dos clasificadores supervisados propios | `src/current_experiment.py` compara Naive Bayes y regresión logística con los datos actuales; no cambia el modelo de la página. |
| Comparación con protocolo común | CV estratificada de cinco pliegues, TF-IDF dentro del pipeline, semilla 42 y métricas en `reports/current-experiment.json`; notebook actualizado. Las 80 consultas conocidas son un benchmark de desarrollo. |
| Justificación del modelo elegido | El informe separa el Naive Bayes activo del candidato ganador por F1 macro de CV; si difieren, su integración sigue pendiente. |
| Guardar modelo y preprocesamiento | `models/` y `web/model.json` |
| Inferencia con modelo entrenado | `web/ml.js`; las fallas nuevas se encaminan con su predicción |
| Variantes de respuesta | Existen plantillas en `web/dialogue.js`, pero el modo sencillo activo sustituye algunas por una respuesta fija. Pendiente revisar el mínimo de tres variantes cuando corresponda. |
| Contexto efectivo de al menos tres turnos | Estado de dispositivo/falla/pregunta pendiente, pruebas de `tests/` |
| Ambigüedad y consultas desconocidas | Rechazo por cobertura/confianza y solicitudes de aclaración; pruebas de diálogo |
| Reinicio del contexto | Acción visible de nueva conversación y comando de reinicio |
| Interfaz para enviar, leer y reiniciar | `web/index.html` y scripts de interfaz |
| Ejecución local admitida por el apartado 3.6 | `iniciar.cmd`, servidores Node/Python y `docs/EJECUTAR-EN-LOCAL.md`; sin necesidad de hosting |
| Accuracy, precision, recall, F1 macro | Para ambos clasificadores y los datos actuales en `reports/current-experiment.json`; los resultados antiguos se conservan por separado. |
| Matriz de confusión de ambos modelos | `reports/current-confusion-naive_bayes.png` y `reports/current-confusion-logistic_regression.png`; notebook y PDF actualizados. |
| Interpretación de al menos tres errores | Predicciones observadas del Naive Bayes actual en notebook, PDF y `reports/current-experiment.json`. |
| Evaluación de expresiones nuevas | Conjunto independiente y pruebas conversacionales |
| Repositorio GitHub | Código preparado en esta carpeta; entregar la URL de un repositorio GitHub del equipo |
| Notebook reproducible | Archivo `.ipynb` en `notebooks/`, dependencias y semilla documentadas |
| PDF de máximo ocho páginas principales | `docs/reporte-tecnico.pdf`; el generador verifica la paginación en `docs/pdf-verification.json`. Fecha de corte: 18 de noviembre de 2026. |
| Demostración y comprensión del equipo | `docs/guia-demostracion.md` |

## Criterios de interpretación

La matriz de confusión mide clasificación de intenciones, no reparación exitosa. La confianza del modelo no expresa la probabilidad de que un componente físico esté averiado. El gestor de diálogo utiliza reglas para continuar una conversación; esas reglas no sustituyen el entrenamiento de los dos clasificadores.

La ejecución de la aplicación es local. El repositorio GitHub solicitado sirve para entregar el código; no es un servidor necesario para la conversación. La entrega debe permitir reproducir el experimento sin credenciales privadas. La consigna no obliga a desplegar en la nube.
