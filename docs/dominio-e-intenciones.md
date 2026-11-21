# Dominio y diseño conversacional

## Objetivo y límites

Orientar al cliente de YinYan Workshop mediante un diagnóstico inicial conversacional de fallas informáticas frecuentes en computadoras, celulares y consolas. El resultado es una comprobación básica o una derivación al taller con un resumen del problema, no un diagnóstico definitivo.

La temática elegida es la **opción B** del proyecto: soporte técnico informático. Aunque el negocio también repara otros aparatos electrónicos, el chatbot no intenta cubrir televisores, electrodomésticos, instalaciones eléctricas o cualquier falla de electrónica. Las respuestas se limitan a dispositivos informáticos y periféricos relacionados.

No se solicitan contraseñas, documentos personales, números de tarjeta ni acceso remoto. La conversación se procesa en el navegador. Una acción de copiar o abrir Instagram no equivale a enviar el texto al taller.

## Intenciones

Las etiquetas corresponden a necesidades comunicativas diferentes. El tipo de equipo es una entidad del diálogo, no una intención nueva.

| Etiqueta | Necesidad comunicativa | Acción esperada |
| --- | --- | --- |
| `saludo` | Iniciar la conversación | Presentarse y pedir equipo o síntoma |
| `despedida` | Cerrar la atención | Despedirse y recordar cómo contactar |
| `ayuda` | Conocer funciones y límites | Mostrar consultas admitidas y ejemplos |
| `encendido` | El equipo no inicia o se apaga al iniciar | Pedir equipo y señales de actividad; orientar revisión externa de alimentación |
| `carga` | Batería o alimentación de carga | Consultar cable/cargador y comportamiento; evitar seguir usando batería dañada |
| `temperatura` | Calor excesivo o apagado térmico | Preguntar ventilación y uso; detener si existe riesgo físico |
| `rendimiento` | Lentitud, bloqueo o respuesta tardía | Distinguir lentitud general de una aplicación y orientar comprobaciones reversibles |
| `conexion` | Problemas de Wi-Fi, Ethernet o red | Preguntar tipo de conexión y si otros dispositivos conectan |
| `pantalla` | Ausencia, daño o anomalía de imagen | Distinguir alimentación, brillo, cable de video y daño físico |
| `sonido` | Ausencia, ruido o falla de audio | Verificar salida seleccionada, volumen y periféricos |
| `almacenamiento` | Poco espacio o problemas de detección de unidades | Preguntar disponibilidad y respaldo; evitar formatear o borrar sin autorización |
| `software` | Aplicaciones, actualizaciones o errores del sistema | Pedir mensaje exacto y contexto del fallo; no recomendar instalar ejecutables desconocidos |
| `controles` | Fallas de mandos, botones y periféricos de entrada | Preguntar conexión y comportamiento; orientar emparejamiento o prueba externa |
| `liquidos` | Contacto con agua u otro líquido | Interrumpir uso y carga; derivar a revisión sin recomendar arroz o desmontaje |
| `presupuesto` | Cotización, costo o duración de reparación | Explicar que requiere valoración y dirigir al perfil del taller |
| `contacto` | Ubicación, horario o canal para atención humana | Abrir el perfil proporcionado; reconocer que no hay dirección/horario verificados |

Se incluyen al menos tres variantes de respuesta en las intenciones donde la acción admite variación, sin cambiar el contenido técnico de la orientación.

## Estado utilizado

El gestor conserva el tipo de equipo, la falla activa, la etapa de la consulta y las respuestas a preguntas pendientes. Una respuesta corta como «Wi-Fi» se interpreta dentro de la pregunta sobre conexión; por sí sola no equivale a una nueva clasificación de síntomas. Las consultas nuevas se clasifican mediante el modelo entrenado. Las reglas de seguridad y los comandos de reinicio tienen prioridad explícita.

El historial visible no sustituye el contexto: los datos retenidos modifican la siguiente pregunta y el resumen. Reiniciar elimina esos datos y deja una conversación nueva.

## Aclaraciones y desconocidos

- Sin equipo o síntoma suficiente: solicitar el dato que falta.
- Mensaje compatible con varias fallas: pedir al usuario que identifique la falla principal.
- Vocabulario sin cobertura o clasificación de baja confianza: reconocer la limitación y proponer una reformulación.
- Tema ajeno a reparación informática: redirigir al dominio sin inventar una respuesta.
- Precio, horario o dirección no configurados: indicar que deben confirmarse directamente en Instagram.
- Líquido, olor a quemado o batería hinchada: priorizar la interrupción del uso y la valoración profesional.

## Procedencia de los datos

La procedencia, el procedimiento de construcción y las particiones del corpus se explican en `data/README.md`. El equipo debe revisar la pertinencia, diversidad y etiquetas antes de la entrega.

Los datos de entrenamiento y prueba se entregan por separado. La prueba se reserva antes de experimentar. El vocabulario y los pesos IDF se ajustan dentro de cada partición de entrenamiento de la validación cruzada, evitando filtración.

Las expresiones de un mismo significado pueden compartir palabras necesarias («pantalla», «batería», «Wi-Fi»), pero no se debe ampliar el corpus mediante simples sustituciones del nombre del equipo. Los resultados del generador incluyen comprobaciones de duplicados y distribución de etiquetas.
