# Procedencia y particiones

## Versión vigente del prototipo

El avance al 18 de noviembre de 2026 utiliza los 240 ejemplos sintéticos de
`simulation.json` (16 intenciones, 15 por intención) y las aportaciones aprobadas
de `team/`. Cada jornada congela sus ejemplos, métricas y modelos en `training/`;
los pendientes y rechazados no se incorporan al entrenamiento.

`test.csv` contiene 80 consultas ya conocidas que se usan como benchmark de
desarrollo. `final-test.csv` está preparado para recibir al menos 50 consultas
adicionales reservadas, que no participarán en el ajuste ni en la selección.
Actualmente el archivo final conserva solo la cabecera; no acredita ese mínimo.

Las etapas iniciales conservan su procedencia sintética y sus fechas originales.
Las aportaciones y jornadas nuevas llevan la fecha real del servidor. Consulta
`docs/FLUJO-DE-TRABAJO.md` y el panel Progreso para conocer los faltantes por clase.

## Experimento anterior conservado como referencia

El dominio es soporte técnico inicial de computadoras, celulares, consolas y sus
periféricos para YinYan Workshop (opción B de la consigna). Los ejemplos fueron
propuestos por una herramienta generativa durante la construcción de este
prototipo; no son conversaciones reales ni fueron recolectados de Instagram.
No contienen información personal. El estudiante debe revisar su pertinencia y
diversidad antes de presentarlos como un corpus validado por el equipo.

`corpus.json` conserva las frases originales y su partición asignada antes del
experimento. `train.csv` contiene 384 ejemplos (24 por cada una de 16 intenciones),
y `test.csv` contiene 80 frases adicionales (5 por intención). `challenge.csv`
añade 16 casos de paráfrasis indirectas o intenciones en competencia, con una
justificación explícita de la etiqueta dominante. El reto no se utiliza para
seleccionar modelo, hiperparámetros, vocabulario o umbrales.

El script valida la ausencia de duplicados exactos y duplicados tras
normalización/tokenización/lematización entre todas las particiones. La asignación
por intención es balanceada; aun así, compartir autor sintético y estilo entre
particiones limita la estimación de generalización. No se afirma que las frases
sean estadísticamente independientes de su proceso de autoría.

La selección usa cinco pliegues estratificados de entrenamiento. En cada pliegue
el TF-IDF se ajusta dentro del pipeline; el vocabulario e IDF de validación y
prueba no se filtran al entrenamiento. Se comparan configuraciones declaradas de
regresión logística y Naive Bayes, sin ajustar la representación con prueba.
Los hashes SHA-256 y el protocolo se guardan en `reports/protocol.json` antes del
ajuste. Las métricas de prueba son finales para esta versión: no se deben usar
para corregir el modelo y volver a afirmar que esa misma prueba es inédita.

## Convenciones de etiquetas

| Intención | Necesidad comunicativa y respuesta |
|---|---|
| saludo | Abrir conversación; bienvenida y solicitud del síntoma. |
| despedida | Cerrar la consulta; cierre sin borrar implícitamente el contexto. |
| ayuda | Conocer capacidades; menú de fallas y límites. |
| encendido | Falta de señales de vida/arranque eléctrico; preguntar equipo y señales. |
| carga | Autonomía, batería o alimentación por cargador; revisión externa segura. |
| temperatura | Calor excesivo, ventilación o alerta térmica; detener uso y enfriar. |
| rendimiento | Lentitud, congelamiento o baja fluidez; diferenciar de error explícito. |
| conexion | Internet, red, Ethernet, Wi-Fi o Bluetooth; preguntar enlace y otros equipos. |
| pantalla | Imagen, HDMI, panel o táctil; separar de ausencia de encendido. |
| sonido | Bocinas, micrófono, audífonos o salida de audio. |
| almacenamiento | Capacidad, archivos o detección de unidades; proteger datos. |
| software | Errores de sistema/apps, instalación, actualización o amenazas. |
| controles | Entrada mediante botones, mandos, teclado, mouse o touchpad. |
| liquidos | Derrame o humedad; suspender carga y solicitar revisión presencial. |
| presupuesto | Solicitar precio/costo; no inventar tarifas, derivar al taller. |
| contacto | Pedir canal, cita, ubicación u horario; enlazar el Instagram proporcionado. |

Ante múltiples síntomas, la etiqueta humana representa la necesidad dominante.
La aplicación puede pedir aclaración o aplicar una precaución por líquidos; esto
se documenta separado de la predicción estadística del clasificador.
