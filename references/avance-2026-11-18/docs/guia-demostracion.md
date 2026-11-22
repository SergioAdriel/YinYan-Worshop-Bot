# Guía para demostrar y defender el proyecto

Duración sugerida: 7–10 minutos. Practicar con palabras propias; no memorizar únicamente estas frases.

## Preparación

1. Clonar el repositorio, configurar Node.js o Python según `docs/EJECUTAR-EN-LOCAL.md` y ejecutar `iniciar.cmd`. Esperar a que abra el navegador y comprobar que carga el modelo y que responde.
2. Tener a mano el notebook, el PDF y las métricas de `reports/`.
3. Completar los datos del equipo. Asegurar que todos puedan explicar el flujo general.
4. Probar desde una conversación nueva. La aplicación, el modelo y los documentos funcionan localmente sin internet; Instagram es una salida externa opcional.

Explicar que `127.0.0.1` o `localhost` es la misma computadora. El profesor admite una aplicación web sencilla y no exige despliegue en la nube. Para mostrar el notebook de forma interactiva se puede abrir `notebook.cmd`; la aplicación y Jupyter tienen consolas distintas que deben mantenerse abiertas mientras se usan.

## Secuencia de demostración

1. **Dominio:** explicar que se eligió la opción B y se limitó el alcance a fallas informáticas frecuentes en computadoras, celulares y consolas.
2. **Aprendizaje propio:** mostrar los ejemplos etiquetados, los dos algoritmos y el archivo del modelo. Explicar cómo el clasificador identifica la intención y el gestor selecciona una plantilla local.
3. **Paráfrasis nueva:** escribir una falla con palabras diferentes de las utilizadas durante entrenamiento. Observar intención/confianza si la interfaz ofrece esa información.
4. **Tres turnos relacionados:** describir una falla, responder el tipo de equipo y después una comprobación. Mostrar que el resumen conserva y utiliza los datos.
5. **Ambigüedad:** escribir «No funciona». El sistema debe pedir información útil en lugar de inventar un diagnóstico.
6. **Fuera del dominio:** preguntar una receta de cocina o un resultado deportivo. Debe reconocer la limitación.
7. **Reinicio:** iniciar una conversación nueva y verificar que no conserva el dispositivo ni el síntoma previo.
8. **Resultados:** mostrar los resultados actuales de `reports/current-experiment.json`, el notebook y el PDF. Explicar accuracy, precision, recall, F1 macro, matrices y un error observado. Distinguir el Naive Bayes activo del candidato ganador por validación; no presentar la prueba conocida de 80 consultas como una evaluación final inédita.

## Tres conversaciones de prueba propuestas

Estas secuencias son guiones de verificación. La evidencia reproducida con el modelo actual y el modo sencillo está en `reports/current-dialogue-results.json`; se genera con `node scripts/check-current-dialogue.mjs`. Las transcripciones de `reports/conversation-results.json` incluyen verificaciones del experimento anterior y no deben confundirse con estas.

### A. Contexto de encendido: secuencia verificada

| Turno del usuario | Comportamiento que se verifica |
| --- | --- |
| «Mi computadora no enciende» | Reconoce encendido y computadora; pregunta si hay luz, vibración o sonido |
| «No» | Conserva equipo/falla y pregunta si se probó otra alimentación compatible |
| «Sí» | Usa la comprobación anterior para ofrecer orientación de encendido |
| «¿Y ahora qué hago?» | Mantiene el problema de encendido y orienta revisión física |
| Copiar resumen | El resumen incluye computadora, encendido y respuestas previas |

### B. Contexto de alimentación

| Turno del usuario | Comportamiento que se verifica |
| --- | --- |
| «Mi celular ya no carga» | Reconoce carga y dispositivo |
| Responder la comprobación que solicite | Usa la respuesta para continuar, sin reiniciar el problema |
| «Ya probé otro cable y sigue igual» | Integra la prueba previa y orienta revisión profesional si corresponde |
| «¿Cuánto cuesta?» | Cambia a presupuesto conservando el resumen de la falla; no inventa monto |

### C. Límites, derivación y reinicio

| Turno del usuario | Comportamiento que se verifica |
| --- | --- |
| «Se cayó agua sobre mi laptop» | Prioriza no encender ni cargar y solicita revisión |
| «¿La puedo conectar para ver si funciona?» | Mantiene la advertencia por el contexto de líquido |
| «¿Cómo contacto al taller?» | Ofrece el perfil real proporcionado, sin inventar una cita |
| Nueva conversación → «No funciona» | Pide equipo/síntoma, sin arrastrar que era una laptop mojada |

## Preguntas que puede hacer el profesor

**¿Dónde está el aprendizaje automático?** En el clasificador entrenado con ejemplos etiquetados: transforma texto a TF-IDF y estima una de las 16 intenciones. El gestor utiliza esa predicción para elegir una acción.

**¿Por qué abre en el navegador si es local?** El navegador es la interfaz. El servidor enlazado a `127.0.0.1` entrega los archivos de esta computadora y el modelo calcula las intenciones en el navegador. No se consulta un servicio externo para responder. Instagram solo se abre si el usuario elige ese enlace.

**¿Por qué dos modelos?** La tarea exige comparar alternativas bajo el mismo protocolo. Regresión logística aprende fronteras discriminativas; Naive Bayes estima la compatibilidad de características y clases bajo una suposición de independencia. Se selecciona usando validación, no la prueba final.

**¿Qué significa TF-IDF?** Da peso a las palabras presentes en un mensaje según su frecuencia local y su rareza en el corpus de entrenamiento. Los mensajes nuevos pueden compartir características con ejemplos aunque no coincidan literalmente.

**¿Por qué F1 macro?** Calcula F1 por clase y promedia dando el mismo peso a cada intención. Permite ver si un modelo falla en alguna intención aunque tenga buen promedio de aciertos.

**¿Qué evita la filtración?** El conjunto final de prueba se mantiene separado y el vectorizador se ajusta dentro del pipeline de cada fold. No se utiliza el vocabulario de prueba para entrenar ni elegir modelos.

**¿El chatbot aprende mientras hablo?** No. La inferencia utiliza un modelo fijo. Aprender nuevas clases requiere revisar datos y repetir el protocolo experimental, con una nueva prueba independiente si se hizo desarrollo sobre la anterior.

**¿Por qué no responde cualquier pregunta?** El clasificador reconoce un conjunto cerrado de intenciones. La cobertura y confianza ayudan a detectar consultas desconocidas, pero no son una garantía perfecta de detección fuera del dominio.

**¿Qué información conserva?** Datos de la conversación actual, como equipo, falla y respuesta pendiente. Cambian las preguntas posteriores y el resumen. El reinicio limpia ese estado.

**¿Cuál es la principal limitación?** Los ejemplos son sintéticos y pequeños; una frase ambigua, dos fallas en el mismo mensaje o jerga desconocida pueden producir errores. No se ha evaluado eficacia de reparación ni satisfacción de clientes reales.

**¿Qué falta para uso comercial?** Validación del propietario de textos y servicios, revisión humana del corpus, evaluación con consultas reales anonimizadas y autorización para cualquier dato comercial adicional. El prototipo no tiene sistema de tickets ni agenda.
