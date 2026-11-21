# Conversaciones verificadas con el modelo entrenado

Estas respuestas provienen de la ejecución automatizada guardada en reports/conversation-results.json. No son diálogos redactados como si hubieran sido ejecutados. La confianza de una respuesta contextual no implica que el sí/no aislado haya clasificado una falla: el gestor utiliza el estado previo.

## encendido_multiturno

**Usuario:** Mi computadora no enciende

**Asistente:** Vamos a revisar las señales de encendido. Al intentar encenderlo, ¿hay alguna luz, vibración o sonido?

Estado utilizado: equipo=computadora, falla=encendido, etapa=pregunta_1.

**Usuario:** No

**Asistente:** Gracias. Seguimos con tu computadora: ¿Ya probaste otro enchufe y un cargador compatible en buen estado?

Estado utilizado: equipo=computadora, falla=encendido, etapa=pregunta_2.

**Usuario:** Sí

**Asistente:** Para tu computadora, con el problema de no enciende: Una falla de encendido puede venir del cargador, batería o circuitos internos. Limita las pruebas a conexiones externas compatibles; si no cambia, hace falta diagnóstico en taller antes de reemplazar piezas.

Esto es orientación inicial, no un diagnóstico confirmado. Puedes copiar el resumen de esta conversación y compartirlo con el taller por Instagram.

Estado utilizado: equipo=computadora, falla=encendido, etapa=orientacion.

**Usuario:** ¿Y ahora qué hago?

**Asistente:** Si tu computadora sigue con el problema de no enciende después de las comprobaciones, solicita revisión física. Si no hay ninguna señal, revisa solo el enchufe y un cable o cargador compatible en buen estado. Si hay luz o sonido pero no imagen, la revisión debe concentrarse en la pantalla o salida de video. No abras la fuente ni hagas puentes eléctricos.

Estado utilizado: equipo=computadora, falla=encendido, etapa=orientacion.

## parafrasis

**Usuario:** Mi laptop está lentísima al abrir programas

**Asistente:** Vamos a ubicar cuándo se vuelve lento. ¿La lentitud afecta a todo el equipo o solo a un programa, juego o página?

Estado utilizado: equipo=computadora, falla=rendimiento, etapa=pregunta_1.

**Usuario:** El teléfono dejó de reconocer el cargador

**Asistente:** Revisemos la carga sin abrir el equipo. ¿Aparece el indicador de carga al conectar un cable y cargador compatibles?

Estado utilizado: equipo=celular, falla=carga, etapa=pregunta_1.

**Usuario:** No puedo conectar mi PC a la red inalámbrica

**Asistente:** Vamos a separar una falla de la red de una falla del equipo. ¿Otros dispositivos pueden navegar usando la misma red?

Estado utilizado: equipo=computadora, falla=conexion, etapa=pregunta_1.

**Usuario:** La pantalla de mi celular tiene rayas

**Asistente:** Vamos a revisar las señales de imagen sin desmontar nada. ¿La pantalla está negra, tiene líneas o muestra imagen pero no responde al tacto?

Estado utilizado: equipo=celular, falla=pantalla, etapa=pregunta_1.

## ambiguedad_fuera_dominio

**Usuario:** No funciona

**Asistente:** No tengo suficiente información para identificar esa consulta. Puedo orientar sobre fallas de computadoras, celulares y consolas. Dime qué equipo usas y qué síntoma presenta.

Estado utilizado: equipo=None, falla=None, etapa=inicio.

**Usuario:** ¿Quién ganó el partido de fútbol?

**Asistente:** Esa consulta es ambigua o queda fuera de mi alcance. Describe una falla de tu computadora, celular o consola; por ejemplo, «mi laptop no enciende».

Estado utilizado: equipo=None, falla=None, etapa=inicio.

## presupuesto_contacto

**Usuario:** ¿Cuánto cuesta reparar mi equipo?

**Asistente:** El costo depende del equipo, el diagnóstico y las piezas necesarias. No tengo una tarifa confirmada ni puedo emitir una cotización. Contacta a YinYan Workshop por Instagram y comparte el modelo y el resumen de la falla.

Estado utilizado: equipo=None, falla=None, etapa=inicio.

**Usuario:** ¿Dónde están ubicados?

**Asistente:** El canal de contacto disponible es @yinyan_workshop en Instagram. Pregunta directamente por el horario, dirección y cómo llevar tu equipo. Esta conversación no crea una cita ni una orden de servicio.

Estado utilizado: equipo=None, falla=None, etapa=inicio.

## reinicio

**Usuario:** Nueva conversación

**Asistente:** Soy el asistente de YinYan Workshop. Cuéntame qué le pasa a tu computadora, celular o consola. Te haré unas preguntas para orientarte antes de la revisión.

Estado utilizado: equipo=None, falla=None, etapa=inicio.

**Usuario:** No

**Asistente:** Necesito una consulta completa para interpretar esa respuesta. Dime qué equipo tienes y qué falla presenta.

Estado utilizado: equipo=None, falla=None, etapa=inicio.

## consultas_rapidas_interfaz

**Usuario:** Mi computadora está muy lenta

**Asistente:** Vamos a ubicar cuándo se vuelve lento. ¿La lentitud afecta a todo el equipo o solo a un programa, juego o página?

Estado utilizado: equipo=computadora, falla=rendimiento, etapa=pregunta_1.

**Usuario:** Mi celular no carga

**Asistente:** Revisemos la carga sin abrir el equipo. ¿Aparece el indicador de carga al conectar un cable y cargador compatibles?

Estado utilizado: equipo=celular, falla=carga, etapa=pregunta_1.

**Usuario:** Mi consola se calienta mucho

**Asistente:** Vamos a revisar cuándo aparece el calentamiento. ¿Se calienta incluso en reposo o principalmente al jugar o usar aplicaciones exigentes?

Estado utilizado: equipo=consola, falla=temperatura, etapa=pregunta_1.

**Usuario:** Mi computadora no enciende

**Asistente:** Vamos a revisar las señales de encendido. Al intentar encenderlo, ¿hay alguna luz, vibración o sonido?

Estado utilizado: equipo=computadora, falla=encendido, etapa=pregunta_1.

**Usuario:** El control de mi consola no responde

**Asistente:** Vamos a revisar la conexión y respuesta del control. ¿El control no se conecta o se conecta y fallan botones o palancas?

Estado utilizado: equipo=consola, falla=controles, etapa=pregunta_1.

## carga_multiturno

**Usuario:** Mi celular no carga

**Asistente:** Revisemos la carga sin abrir el equipo. ¿Aparece el indicador de carga al conectar un cable y cargador compatibles?

Estado utilizado: equipo=celular, falla=carga, etapa=pregunta_1.

**Usuario:** No aparece el indicador de carga

**Asistente:** Gracias. Seguimos con tu celular: ¿El cable o el conector tienen daño visible, suciedad o se desconectan al moverlos?

Estado utilizado: equipo=celular, falla=carga, etapa=pregunta_2.

**Usuario:** El cable está dañado

**Asistente:** Para tu celular, con el problema de carga o batería: Comprueba únicamente conexiones externas y accesorios compatibles. Si el porcentaje no sube, se apaga al desconectarlo o el puerto está flojo, requiere revisión física; no se puede determinar la pieza solo por chat.

Esto es orientación inicial, no un diagnóstico confirmado. Puedes copiar el resumen de esta conversación y compartirlo con el taller por Instagram.

Estado utilizado: equipo=celular, falla=carga, etapa=orientacion.

## fuera_dominio_redireccion

**Usuario:** Dame una receta de pastel

**Asistente:** Empecemos con una falla a la vez. Por ejemplo: «mi celular no carga» o «mi computadora está lenta». Haré preguntas de seguimiento y te daré comprobaciones básicas sin desmontar el equipo.

Estado utilizado: equipo=celular, falla=carga, etapa=pregunta_1.

## liquidos_contexto_seguro

**Usuario:** Se cayó agua sobre mi laptop

**Asistente:** Si cayó líquido, deja de usarlo, apágalo si es posible sin riesgo y desconecta la alimentación externa. No lo cargues, no uses secadora y no lo metas en arroz. No intentes encenderlo para comprobar si funciona. Necesita revisión física cuanto antes.

Estado utilizado: equipo=computadora, falla=liquidos, etapa=orientacion.

**Usuario:** ¿La puedo conectar para ver si funciona?

**Asistente:** Un equipo mojado no debe volver a encenderse ni cargarse para probarlo. Desconecta solo lo que puedas hacer con seguridad, evita calor y arroz, y solicita revisión. No puedo evaluar corrosión o daño interno desde el chat.

Estado utilizado: equipo=computadora, falla=liquidos, etapa=orientacion.

**Usuario:** ¿Cómo contacto al taller?

**Asistente:** Abre el perfil de Instagram de YinYan Workshop para coordinar la revisión. Comparte el tipo de equipo, modelo y resumen del síntoma; el taller confirmará los siguientes pasos.

Estado utilizado: equipo=computadora, falla=liquidos, etapa=orientacion.
