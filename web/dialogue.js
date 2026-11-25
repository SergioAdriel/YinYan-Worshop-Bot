/**
 * Gestor de diálogo de YinYan Workshop.
 * El clasificador supervisado decide las intenciones; las reglas resuelven
 * controles explícitos, entidades, respuestas a preguntas activas y seguridad.
 * Ningún dato se envía al taller desde este módulo.
 */

const INSTAGRAM = 'https://www.instagram.com/yinyan_workshop/';
const FAULTS = new Set(['encendido', 'carga', 'temperatura', 'rendimiento', 'conexion', 'pantalla', 'sonido', 'almacenamiento', 'software', 'controles', 'liquidos']);
const normalize = text => String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[¿¡]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const pick = (list, turn) => list[(Math.max(turn, 1) - 1) % list.length];

const LABELS = {
  encendido: 'no enciende', carga: 'carga o batería', temperatura: 'calentamiento',
  rendimiento: 'lentitud', conexion: 'conexión a internet', pantalla: 'pantalla o imagen',
  sonido: 'audio', almacenamiento: 'almacenamiento', software: 'sistema o aplicaciones',
  controles: 'controles y botones', liquidos: 'contacto con líquidos',
};

const OPENERS = {
  encendido: ['Vamos a revisar las señales de encendido.', 'Primero distingamos una falla de energía de una falla de imagen.', 'Empecemos por lo que hace el equipo al intentar encender.'],
  carga: ['Revisemos la carga sin abrir el equipo.', 'Vamos a distinguir un problema del cargador de uno del equipo.', 'Empecemos por las señales de carga y el estado del cable.'],
  temperatura: ['Vamos a revisar cuándo aparece el calentamiento.', 'Primero revisemos la ventilación y las condiciones de uso.', 'El momento en que se calienta nos ayuda a orientar la revisión.'],
  rendimiento: ['Vamos a ubicar cuándo se vuelve lento.', 'Revisemos si la lentitud es general o aparece en una tarea.', 'Primero distingamos lentitud del sistema de lentitud de internet.'],
  conexion: ['Vamos a separar una falla de la red de una falla del equipo.', 'Revisemos qué parte de la conexión está fallando.', 'Empecemos comparando la conexión con otro dispositivo.'],
  pantalla: ['Vamos a revisar las señales de imagen sin desmontar nada.', 'Primero distingamos un problema de imagen de uno de encendido.', 'Revisemos qué muestra la pantalla y si el equipo sigue funcionando.'],
  sonido: ['Vamos a revisar la salida de audio.', 'Primero distingamos una falla de sonido general de una sola aplicación.', 'Revisemos volumen, salida de audio y accesorios.'],
  almacenamiento: ['Vamos a revisar el espacio disponible sin borrar tus archivos.', 'Primero identifiquemos qué aviso de almacenamiento aparece.', 'Revisemos si falta espacio o si la unidad deja de detectarse.'],
  software: ['Vamos a identificar el error del sistema o de la aplicación.', 'Revisemos cuándo comenzó el problema de software.', 'Primero ubiquemos si el fallo ocurre en una aplicación o en todo el sistema.'],
  controles: ['Vamos a revisar la conexión y respuesta del control.', 'Primero distingamos un botón defectuoso de un problema de conexión.', 'Revisemos el control sin abrirlo.'],
  liquidos: ['Lo primero es evitar más daño por el líquido.', 'Antes del diagnóstico, hay que dejar de usar el equipo mojado.', 'Vamos a priorizar la seguridad del equipo y tus datos.'],
};

const QUESTIONS = {
  encendido: {
    first: 'Al intentar encenderlo, ¿hay alguna luz, vibración o sonido?',
    second: answer => answer === 'no' ? '¿Ya probaste otro enchufe y un cargador compatible en buen estado?' : '¿La pantalla permanece negra aunque haya señales de encendido?',
    detail: /\b(luz|luces|led|vibra|vibracion|sonido|enciende|prende|nada|ninguna|negra|pantalla|imagen|ventilador|enchufe|cargador)\b/,
    advice: [
      'Si no hay ninguna señal, revisa solo el enchufe y un cable o cargador compatible en buen estado. Si hay luz o sonido pero no imagen, la revisión debe concentrarse en la pantalla o salida de video. No abras la fuente ni hagas puentes eléctricos.',
      'Las señales que describiste permiten distinguir alimentación de imagen, pero no confirmar una pieza dañada. Comprueba conexiones externas y, si persiste, solicita una revisión física. No desmontes baterías ni fuentes.',
      'Una falla de encendido puede venir del cargador, batería o circuitos internos. Limita las pruebas a conexiones externas compatibles; si no cambia, hace falta diagnóstico en taller antes de reemplazar piezas.',
    ],
  },
  carga: {
    first: '¿Aparece el indicador de carga al conectar un cable y cargador compatibles?',
    second: '¿El cable o el conector tienen daño visible, suciedad o se desconectan al moverlos?',
    detail: /\b(cable|cargador|conector|bateria|porcentaje|carga|indicador|intermitente|suelto|sucia|suciedad)\b/,
    advice: [
      'Prueba un enchufe y un cable compatibles que sepas que funcionan, sin forzar el conector. No introduzcas objetos metálicos ni líquidos en el puerto. Si sigue igual, conviene revisar el puerto y la batería en taller.',
      'Una carga intermitente puede relacionarse con el cable o el puerto; no confirma que la batería esté dañada. Evita mover o sujetar el cable a presión para que cargue y solicita revisión si el problema continúa.',
      'Comprueba únicamente conexiones externas y accesorios compatibles. Si el porcentaje no sube, se apaga al desconectarlo o el puerto está flojo, requiere revisión física; no se puede determinar la pieza solo por chat.',
    ],
  },
  temperatura: {
    first: '¿Se calienta incluso en reposo o principalmente al jugar o usar aplicaciones exigentes?',
    second: '¿Se apaga por temperatura o muestra una advertencia de sobrecalentamiento?',
    detail: /\b(reposo|jugar|juego|caliente|calienta|calor|siempre|apaga|ventila|ventilador|uso|rato)\b/,
    advice: [
      'Apágalo si el calor es excesivo y deja que se enfríe de forma natural. Úsalo sobre una superficie firme con ventilaciones libres; evita telas, sol directo y seguir jugando si se apaga. Si ocurre en reposo, necesita revisión.',
      'Reduce temporalmente la carga de trabajo y revisa que nada tape las salidas de aire. No lo metas al refrigerador ni le apliques líquidos. Los apagados repetidos justifican una revisión de ventilación y temperatura.',
      'El calentamiento leve durante tareas intensas puede ocurrir, pero una alerta o apagado requiere detener el uso. Mantén la ventilación libre y solicita diagnóstico si se repite; no hace falta desmontarlo para estas comprobaciones.',
    ],
  },
  rendimiento: {
    first: '¿La lentitud afecta a todo el equipo o solo a un programa, juego o página?',
    second: '¿Comenzó después de instalar o actualizar algo, o al quedarse sin espacio?',
    detail: /\b(todo|todos|programa|aplicacion|juego|pagina|inicio|arrancar|lento|lenta|tarda|siempre|actualiz|espacio)\b/,
    advice: [
      'Guarda tu trabajo, reinicia normalmente y cierra aplicaciones que no uses. Revisa espacio libre y actualizaciones oficiales. Si solo falla una página, puede ser la conexión; no formatees ni borres archivos para probar.',
      'Si todo el sistema está lento, revisa aplicaciones de inicio y espacio disponible sin eliminar datos personales. Si solo ocurre en un juego o programa, anota cuál y cuándo pasa para orientar la revisión.',
      'La lentitud por sí sola no demuestra que necesites cambiar piezas. Prueba un reinicio normal, menos aplicaciones abiertas y actualizaciones oficiales. Conserva una copia de tus archivos importantes antes de cualquier reparación.',
    ],
  },
  conexion: {
    first: '¿Otros dispositivos pueden navegar usando la misma red?',
    second: '¿Este equipo detecta la red, pero muestra «sin internet» o falla al conectarse?',
    detail: /\b(wifi|wi fi|red|redes|router|modem|internet|conecta|detecta|otros|ninguno|navega|ethernet|inalambrica)\b/,
    advice: [
      'Si otros equipos tampoco navegan, revisa el servicio de internet y reinicia el módem normalmente, sin restablecerlo de fábrica. Si solo falla este equipo, desactiva y activa Wi-Fi y verifica que esté deshabilitado el modo avión.',
      'Comparar con otro dispositivo ayuda a ubicar el problema. Puedes probar una red de confianza y reiniciar normalmente el equipo. No compartas aquí tu contraseña de Wi-Fi ni restablezcas el router de fábrica.',
      'Cuando solo falla un equipo, revisa modo avión, Wi-Fi y actualizaciones oficiales del adaptador o sistema. Si todos fallan, consulta al proveedor de internet. No cambies configuraciones avanzadas sin registrar las actuales.',
    ],
  },
  pantalla: {
    first: '¿La pantalla está negra, tiene líneas o muestra imagen pero no responde al tacto?',
    second: '¿El equipo da luz, sonido o vibración y el problema comenzó después de un golpe?',
    detail: /\b(negra|negro|lineas|rayas|imagen|tactil|tacto|golpe|quebrada|rota|parpadea|brillo|vibra|sonido)\b/,
    advice: [
      'Revisa brillo y conexiones externas de video, si tu equipo las usa. Una pantalla con líneas, daño físico o tacto que no responde requiere inspección; no presiones el panel ni uses calor. Si no hay señales de vida, revisaremos también encendido.',
      'Si hay sonido o vibración, puede haber una falla de imagen, aunque el chat no identifica la pieza. Comprueba solo brillo y cable externo compatible. Con grietas o después de un golpe, evita presionar la pantalla y solicita revisión.',
      'Anota si hay imagen, líneas o respuesta táctil para el diagnóstico. Puedes reconectar el cable de video externo con el equipo apagado cuando corresponda. No desmontes el panel ni hagas presión para recuperar la imagen.',
    ],
  },
  sonido: {
    first: '¿El sonido falla en todas las aplicaciones o solo en una?',
    second: '¿Está conectado a audífonos, HDMI o algún dispositivo Bluetooth?',
    detail: /\b(audio|sonido|volumen|audifonos|bocina|altavoz|bluetooth|hdmi|microfono|todas|solo|aplicacion|escucha)\b/,
    advice: [
      'Comprueba volumen, silencio y la salida seleccionada. Desconecta audífonos o Bluetooth para probar los altavoces y compara dos aplicaciones. Si el fallo continúa en todas las salidas, requiere revisión.',
      'A veces el audio sale por HDMI o Bluetooth en lugar de la bocina. Revisa la salida de audio y prueba otro contenido. Para el micrófono, revisa permisos del sistema sin instalar controladores de sitios desconocidos.',
      'Prueba volumen y otra aplicación, después elige la salida correcta. No introduzcas objetos en los conectores. Si solo falla una bocina o hay sonido distorsionado constante, anótalo para la revisión física.',
    ],
  },
  almacenamiento: {
    first: '¿El aviso dice que falta espacio o que no se detecta la unidad o tarjeta?',
    second: '¿Tienes una copia de los archivos importantes en otro lugar?',
    detail: /\b(espacio|lleno|llena|memoria|disco|unidad|tarjeta|detecta|copia|archivos|almacenamiento|gb)\b/,
    advice: [
      'Haz primero una copia de los archivos importantes si la unidad todavía responde. Revisa el desglose de almacenamiento del sistema y elimina únicamente lo que reconozcas y ya tengas respaldado. No formatees una unidad que no se detecta.',
      'Falta de espacio y una unidad no detectada son problemas diferentes. En el primer caso, revisa almacenamiento y respaldos; en el segundo, evita formatear o insistir si aparecen ruidos extraños y solicita diagnóstico.',
      'Conserva tus datos antes de modificar el almacenamiento. Puedes revisar qué ocupa espacio desde las herramientas del sistema. No aceptes opciones de inicializar, borrar o formatear una unidad si necesitas recuperar su contenido.',
    ],
  },
  software: {
    first: '¿El error afecta a una sola aplicación o impide iniciar el sistema?',
    second: '¿Empezó después de una instalación o actualización y puedes anotar el mensaje exacto?',
    detail: /\b(error|mensaje|pantallazo|actualizacion|instalacion|actualiz|instal|aplicacion|programa|sistema|windows|android|inicia|arranca)\b/,
    advice: [
      'Anota el mensaje exacto, guarda lo que puedas y prueba un reinicio normal. Usa actualizaciones del fabricante o tiendas oficiales. Si no inicia, evita restablecer de fábrica o reinstalar antes de respaldar tus datos.',
      'Un código o captura del error ayuda más que intentar muchas instalaciones. Revisa actualizaciones oficiales y si el fallo ocurre en una sola aplicación. No descargues reparadores desconocidos ni borres el sistema.',
      'Si falla una aplicación, revisa su actualización oficial; si falla todo el sistema, hace falta revisar el inicio y conservar los datos. No puedo confirmar la causa por chat ni recomendar un formateo sin respaldo.',
    ],
  },
  controles: {
    first: '¿El control no se conecta o se conecta y fallan botones o palancas?',
    second: '¿El problema sigue después de cargarlo y probar una conexión compatible por cable, si la admite?',
    detail: /\b(control|mando|boton|botones|palanca|joystick|drift|conecta|cable|carga|bateria|sincroniza|mueve)\b/,
    advice: [
      'Prueba la carga y el emparejamiento desde el menú oficial de la consola. Si admite cable, utiliza uno compatible. Para botones atascados o drift persistente, evita líquidos y desmontajes y solicita revisión.',
      'Si se conecta pero falla una palanca, el problema es distinto del emparejamiento. Revisa las opciones de calibración oficiales de tu consola cuando existan; si continúa, necesita revisión física.',
      'Comprueba carga, cable compatible y emparejamiento oficial. No fuerces botones ni apliques limpiadores dentro del control. Anota qué botón falla y si sucede en varios juegos para orientar al taller.',
    ],
  },
};

// El modo del taller usa textos breves; la clasificación y el contexto son los mismos.
const SHORT_ADVICE = {
  encendido: 'Revisa el enchufe y las conexiones externas. Prueba un cargador compatible que funcione. Si hay luces pero no imagen, puede ser otro problema y necesita revisión.',
  carga: 'Prueba otro cable y cargador compatibles, sin forzar el puerto. Si sigue sin cargar, llévalo a revisión.',
  temperatura: 'Si se calienta demasiado, apágalo y deja que se enfríe. Revisa que la ventilación esté libre. Si se repite, necesita revisión.',
  rendimiento: 'Guarda tu trabajo, reinicia y cierra programas que no uses. Revisa el espacio disponible sin borrar tus archivos. Si sigue lento, conviene revisarlo.',
  conexion: 'Comprueba si otros equipos tienen internet en esa red. Si solo falla el tuyo, revisa Wi-Fi y modo avión. Puedes reiniciar el módem normalmente, sin restablecerlo de fábrica.',
  pantalla: 'Revisa el brillo y el cable de video externo, si tiene uno. Si hay golpes, líneas o sigue sin imagen, necesita revisión. Evita presionar o abrir la pantalla.',
  sonido: 'Revisa volumen, silencio y la salida de audio. Desconecta audífonos o Bluetooth y prueba otra aplicación.',
  almacenamiento: 'Revisa qué ocupa espacio y respalda tus archivos importantes. Si la unidad no aparece, evita formatearla y pide una revisión.',
  software: 'Anota el mensaje de error y prueba un reinicio normal. Usa actualizaciones oficiales. Respalda tus archivos antes de reinstalar o restablecer el equipo.',
  controles: 'Revisa carga, cable y emparejamiento desde el menú de la consola. Si siguen fallando los botones o las palancas, llévalo a revisión.',
};
const SHORT_ALTERNATIVES = {
  encendido: ['Comprueba solo alimentación y cables compatibles. Si hay sonido pero no imagen, anótalo para la revisión del taller.', 'Prueba un enchufe seguro y un cargador compatible. Si no cambia, requiere revisión física; no abras fuentes ni baterías.'],
  carga: ['Comprueba cables y cargadores compatibles sin forzar el conector. Si la carga sigue fallando, pide una revisión del puerto y la batería.', 'Revisa solo accesorios compatibles y conexiones externas. Evita mover el cable a presión; si no carga, conviene llevarlo al taller.'],
  temperatura: ['Detén el uso si el calor es excesivo y deja enfriar el equipo naturalmente. Libera las ventilaciones y solicita revisión si se repite.', 'Mantén las salidas de aire libres y reduce las tareas exigentes. Si muestra alertas o se apaga por calor, apágalo y busca revisión.'],
  rendimiento: ['Cierra lo que no uses y reinicia después de guardar tus archivos. Revisa espacio y actualizaciones oficiales, sin formatear para probar.', 'Anota si falla todo el equipo o un solo programa. Guarda el trabajo y prueba un reinicio normal; si persiste, pide una revisión.'],
  conexion: ['Compara con otro equipo en la misma red. Revisa Wi-Fi y modo avión; si ninguno navega, consulta al proveedor de internet.', 'Prueba una red de confianza y reinicia normalmente el equipo. Si todos fallan, revisa el servicio; no restablezcas el módem de fábrica.'],
  pantalla: ['Comprueba brillo y conexión externa de video cuando exista. Evita presionar la pantalla; con líneas o golpes, solicita revisión.', 'Si hay luz o sonido pero no imagen, anótalo para el taller. Revisa solo cables externos y brillo, sin desmontar el panel.'],
  sonido: ['Confirma la salida de audio y que no esté en silencio. Prueba sin Bluetooth ni audífonos y compara con otra aplicación.', 'Comprueba volumen y dispositivo de salida. Si solo falla una aplicación, anota cuál; si persiste en todas, pide una revisión.'],
  almacenamiento: ['Antes de cambiar archivos, conserva un respaldo. Revisa el espacio disponible; si no detecta la unidad, no la formatees para probar.', 'Distingue falta de espacio de una unidad que desaparece. Respalda lo importante y solicita revisión antes de borrar o formatear.'],
  software: ['Guarda el error exacto y cuándo comenzó. Prueba reiniciar y usa actualizaciones oficiales; conserva respaldo antes de reinstalar.', 'Comprueba si falla una aplicación o todo el sistema. Anota el mensaje y evita ejecutables desconocidos; respalda antes de restablecer.'],
  controles: ['Prueba carga y conexión del mando o periférico. Revisa el emparejamiento desde el menú; si los botones no responden, solicita revisión.', 'Comprueba cable, carga y enlace del control sin abrirlo. Si otro control funciona y este no, conviene una revisión física.'],
};

const FOLLOWUP_QUESTIONS = {
  reinicios: {
    first: '¿Se reinicia también cuando no estás usando ninguna aplicación?',
    second: '¿Empezó después de actualizar el sistema o instalar una aplicación?',
    detail: /\b(reinicia|reinicios|logo|aplicacion|actualiz|instal|siempre|reposo|solo)\b/,
    advice: ['Si puedes usarlo unos minutos, respalda tus archivos. Si sigue reiniciándose, llévalo al taller. Evita restablecerlo de fábrica sin respaldo.', 'Anota cuándo vuelve a aparecer el logo. Respalda si el equipo lo permite y pide revisión si continúa; evita borrar tus datos para probar.', 'Si los reinicios se repiten, conserva un respaldo cuando sea posible y solicita revisión. No restablezcas el sistema sin proteger los archivos.'],
  },
  parpadeo: {
    first: '¿La pantalla parpadea también sin abrir ninguna aplicación?',
    second: '¿La pantalla recibió algún golpe antes de empezar a parpadear?',
    detail: /\b(parpadea|parpadia|pantalla|imagen|brillo|golpe|aplicacion|siempre|rato)\b/,
    advice: ['Anota cuándo parpadea y si el teléfono sigue funcionando. Si se repite, conviene revisar la pantalla. Evita presionarla o abrir el equipo.', 'Observa si el parpadeo ocurre también sin aplicaciones abiertas. Si persiste, solicita revisión de imagen; no presiones ni desmontes el panel.', 'Registra si hay líneas, golpes o parpadeo constante. Evita abrir o calentar la pantalla y llévala a revisión si vuelve a fallar.'],
  },
};
const SYMPTOM_OPTIONS = ['Se reinicia y sale el logo', 'Solo parpadea la pantalla', 'No estoy seguro'];
const BASIC_OPTIONS = ['No enciende', 'No carga', 'Falla la pantalla', 'Se reinicia y sale el logo'];
const DEVICE_PATTERNS = [
  ['computadora', /\b(computadora|computador|ordenador|pc|laptop|portatil|macbook|imac|mac|notebook|compu|lap)\b/],
  ['celular', /\b(celular|telefono|movil|iphone|ipone|iphon|android|samsung|tablet|tableta|ipad|cel)\b/],
  ['consola', /\b(consola|playstation|xbox|nintendo|switch|ps[345]|ps [345])\b/],
];

// Pistas para preguntar qué ocurre; no cambian la predicción del modelo.
function ambiguousSymptom(text) {
  const negative = /\bno (?:se )?(?:prende|enciende|reinicia|apaga|parpadea|parpadia)\b/.test(text);
  if (negative) return false;
  const restarting = /\b(se reinicia|reinicios|reinicia solo)\b/.test(text)
    || (/\bapaga\b/.test(text) && /\b(prende|enciende|encender|prender)\b/.test(text));
  const blinking = /\b(parpadea|parpadean|parpadeo|parpadeando|parpadia)\b/.test(text)
    && (!/\b(luz|luces|led|indicador|control|mando)\b/.test(text) || /\b(pantalla|imagen)\b/.test(text));
  return restarting ? 'reinicios' : blinking ? 'parpadeo' : null;
}

function technicalDescription(text) {
  return !/\b(comprar|compro|comprarme|recomienda|vender|vendo)\b/.test(text)
    && /\b(prende|enciende|arranca|carga|calienta|lento|lenta|pantalla|parpadea|parpadia|reinicia|reinicios|apaga|falla|error|sonido|internet|bateria|roto|rota)\b/.test(text);
}

function detectDevice(text) {
  return DEVICE_PATTERNS.find(([,pattern]) => pattern.test(text))?.[0] || null;
}

function answerKind(text) {
  if (/^(si|sip|simon|afirmativo|correcto|claro|ya lo hice|ya probe)(\b|[,.!])/.test(text)) return 'si';
  if (/^(no|nop|negativo|ningun[ao]?|todavia no|aun no)(\b|[,.!])/.test(text)) return 'no';
  return 'detalle';
}

function isShortAnswer(text) {
  return /^(si|sip|simon|afirmativo|correcto|claro|no|nop|negativo|todavia no|aun no|ya lo hice|ya probe|sigue igual|igual|no se|no estoy segur[oa])[.!?\s]*$/.test(text);
}

function isDeviceOnly(text) {
  const name = text.replace(/^(?:(?:es|tengo|uso|mi|un|una|el|la)\s+)*/, '').replace(/[.!?]+$/, '');
  return DEVICE_PATTERNS.some(([,pattern]) => pattern.exec(name)?.[0] === name);
}

// Estas pistas se utilizan únicamente para pedir una aclaración entre síntomas;
// nunca sustituyen al clasificador para elegir la intención de una consulta.
function competingSymptoms(text) {
  const hints = [
    ['encendido', /\b(no (enciende|prende|arranca))\b/],
    ['carga', /\b(no carga|no esta cargando|carga lento)\b/],
    ['temperatura', /\b(se calienta|sobrecalienta|muy caliente)\b/],
    ['conexion', /\b(sin internet|no conecta|no se conecta)\b/],
    ['pantalla', /\b(pantalla (negra|rota|quebrada)|lineas en la pantalla)\b/],
    ['sonido', /\b(no (?:se (?:oye|escucha)|tiene sonido)|sin sonido)\b/],
    ['rendimiento', /\b(esta lent[oa]|muy lent[oa]|se traba)\b/],
  ];
  return hints.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

export function createConversation(classifier, config = {}) {
  if (!classifier || typeof classifier.predict !== 'function') throw new TypeError('Se necesita un clasificador entrenado con predict(text).');
  const instagramUrl = config.instagramUrl || INSTAGRAM;
  const freshRecovery = () => ({attempts:0, description:null, referred:false});
  const state = { device: null, issue: null, stage: 'inicio', turnCount: 0, details: {}, lastIntent: null, history: [], pending: null, recovery:freshRecovery() };
  // Cada cambio de falla abre un caso nuevo dentro de la misma conversación.
  let caseStart = 1;

  function contact() { return [{ label: 'Contactar por Instagram', url: instagramUrl }]; }
  function activeQuestions() { return FOLLOWUP_QUESTIONS[state.details.variant] || QUESTIONS[state.issue]; }

  function result(text, intent, prediction = {}, {preserveText = false, ...extra} = {}) {
    if (config.concise && !extra.safety && !preserveText) {
      if (QUESTIONS[intent]) {
        if (text.startsWith('Está bien.')) text = 'Está bien. Podemos dejar esa comprobación para el taller. ¿Tienes otro detalle de la falla?';
        else if (state.stage === 'dispositivo') text = '¿Te pasa en una computadora, un celular o una consola?';
        else if (state.pending?.kind === 'diagnostico') {
          const question = activeQuestions();
          text = state.pending.index === 1 ? question.first : typeof question.second === 'function' ? question.second(answerKind(state.details.respuesta_1 || '')) : question.second;
        } else if (state.stage === 'orientacion') {
          const advice = FOLLOWUP_QUESTIONS[state.details.variant]?.advice || (SHORT_ADVICE[intent] ? [SHORT_ADVICE[intent], ...SHORT_ALTERNATIVES[intent]] : null);
          if (advice) text = pick(advice, state.turnCount);
        }
      }
    }
    const response = {
      text, intent, confidence: Number.isFinite(prediction.confidence) ? prediction.confidence : null,
      accepted: prediction.accepted ?? true, actions: [], suggestions: [],
      context: { device: state.device, issue: state.issue, stage: state.stage }, safety: false,
      ...extra,
    };
    state.lastIntent = intent;
    state.history.push({ role: 'assistant', text });
    return response;
  }

  function reset() {
    caseStart = 1;
    Object.assign(state, { device: null, issue: null, stage: 'inicio', turnCount: 0, details: {}, lastIntent: null, history: [], pending: null, recovery:freshRecovery() });
    return result('Soy el asistente de YinYan Workshop. Cuéntame qué le pasa a tu computadora, celular o consola. Te haré unas preguntas para orientarte antes de la revisión.', 'saludo', {}, {
      suggestions: ['Mi computadora no enciende', 'Mi celular no carga', 'Mi consola se calienta'],
    });
  }

  function askFirst(prediction) {
    state.stage = 'pregunta_1';
    state.pending = { kind: 'diagnostico', index: 1 };
    return result(`${pick(OPENERS[state.issue], state.turnCount)} ${activeQuestions().first}`, state.issue, prediction, {
      suggestions: ['Sí', 'No', 'No estoy seguro'],
    });
  }

  function beginFault(intent, prediction, variant = null, description = null) {
    if (state.issue !== intent || variant !== (state.details.variant || null)) {
      if (state.issue) caseStart = state.turnCount;
      state.details = {};
    }
    state.recovery = freshRecovery();
    state.issue = intent;
    if (variant) state.details.variant = variant;
    if (description) state.details.descripcion = description;
    if (!state.details.descripcion) state.details.descripcion = state.history.findLast(row => row.role === 'user')?.text || '';
    if (!state.device) {
      state.stage = 'dispositivo';
      state.pending = { kind: 'dispositivo' };
      return result(`${pick(OPENERS[intent], state.turnCount)} ¿Te pasa en una computadora, un celular o una consola?`, intent, prediction, {
        suggestions: ['Computadora', 'Celular', 'Consola'],
      });
    }
    return askFirst(prediction);
  }

  function referUnclear(prediction, suggestions = BASIC_OPTIONS) {
    state.recovery.referred = true;
    return result('Con estos datos todavía no logro ubicar la falla. Puedes elegir una de las opciones o compartir el resumen con el taller para que te ayuden.', 'aclaracion', prediction, {actions:contact(), suggestions});
  }

  function askSymptom(prediction, original, newContext = false) {
    if (state.pending?.kind !== 'aclarar_sintoma' || newContext) {
      state.recovery = {...freshRecovery(), description:original};
      const device = detectDevice(normalize(original));
      if (device) state.device = device;
      state.issue = null; state.details = {}; state.stage = 'aclaracion';
      state.pending = {kind:'aclarar_sintoma'};
    }
    state.recovery.attempts += 1;
    if (state.recovery.attempts > 2) return referUnclear(prediction, SYMPTOM_OPTIONS);
    const deviceName = state.device || 'equipo';
    const text = state.recovery.attempts === 1
      ? `Para entenderlo mejor: ¿se reinicia todo el ${deviceName} y vuelve a salir el logo, o solo parpadea la pantalla?`
      : 'Ya tengo ese detalle. Elige lo que más se parece: ¿se reinicia y sale el logo, o solo parpadea la pantalla?';
    return result(text, 'aclaracion', prediction, {suggestions:SYMPTOM_OPTIONS, actions:state.recovery.attempts === 2 ? contact() : []});
  }

  function resolveChoice(text, prediction) {
    const kind = state.pending?.kind;
    if (!['aclarar_sintoma','menu_falla','elegir_falla'].includes(kind)
      && !(kind === 'diagnostico' && state.recovery.attempts > 0)) return null;
    let intent, variant = null;
    if (/^(solo )?(parpadea la pantalla|la pantalla parpadea|parpadea|la pantalla|pantalla)[.!?]*$/.test(text) || /^es (?:solo )?la pantalla[.!?]*$/.test(text)) {intent = 'pantalla'; variant = 'parpadeo';}
    else if (/^(se reinicia y sale el logo|se reinicia todo(?: el (?:celular|telefono|equipo))?|sale el logo|aparece el logo|se reinicia solo|reinicios)[.!?]*$/.test(text)) {intent = 'software'; variant = 'reinicios';}
    else {
      const options = {encendido:['no enciende','no prende'], carga:['no carga'], pantalla:['falla la pantalla','pantalla o imagen'], temperatura:['se calienta','calentamiento'], rendimiento:['lentitud','esta muy lento'], conexion:['sin internet','conexion a internet'], sonido:['audio','sin sonido']};
      intent = Object.entries(options).find(([,values]) => values.includes(text.replace(/[.!?]+$/, '')))?.[0];
      intent ||= Object.entries(LABELS).find(([,caption]) => normalize(caption) === text.replace(/[.!?]+$/, ''))?.[0];
    }
    if (kind === 'elegir_falla' && !state.pending.candidates.includes(intent)) return null;
    if (intent) {
      const description = state.recovery.description;
      state.pending = null;
      if (intent === 'liquidos') {
        state.recovery = freshRecovery(); state.issue = intent; state.stage = 'orientacion';
        return {...liquidResponse(prediction), resolution:'user_choice'};
      }
      const response = beginFault(intent, prediction, variant, description);
      return {...response, resolution:'user_choice'};
    }
    if (/^(no se|no estoy segur[oa]|ninguna|otro problema|otra falla)[.!?]*$/.test(text)) return referUnclear(prediction, kind === 'aclarar_sintoma' ? SYMPTOM_OPTIONS : BASIC_OPTIONS);
    return null;
  }

  function recoverUnknown(prediction, original) {
    state.recovery.attempts += 1;
    if (!state.recovery.description && technicalDescription(normalize(original))) state.recovery.description = original;
    if (state.recovery.attempts >= 3) return referUnclear(prediction);
    if (state.recovery.attempts === 2) {
      if (!state.pending) state.pending = {kind:'menu_falla'};
      return result('Todavía no logro reconocerlo. Elige una opción parecida a tu problema; si no coincide, puedes contactar al taller.', 'desconocida', prediction, {suggestions:BASIC_OPTIONS,actions:contact()});
    }
    const text = state.device && technicalDescription(normalize(original))
      ? `Entendí que es un ${state.device}, pero me falta ubicar la falla. ¿No prende, no carga o tiene problemas de pantalla?`
      : 'No entendí bien esa consulta. Dime qué le pasa a tu computadora, celular o consola, o elige una de las opciones.';
    if (!state.pending) state.pending = {kind:'menu_falla'};
    return result(text, 'desconocida', prediction, {suggestions:BASIC_OPTIONS});
  }

  function handleSlot(text, prediction, contextual) {
    if (!state.pending || state.pending.kind !== 'diagnostico' || !QUESTIONS[state.issue]) return null;
    const question = activeQuestions();
    const shortAnswer = isShortAnswer(text);
    const activeIntent = prediction.accepted && prediction.intent === state.issue;
    const directObservation = /^(el|la|los|las|mi|mis) (cable|cargador|conector|bateria|pantalla|router|modem|control|mando|boton|botones|palanca|volumen|disco|unidad|tarjeta|memoria|indicador|porcentaje|altavoz|bocina|audifonos)\b/.test(text);
    const answerFragment = (/^(solo|solamente|unicamente|todo|todas|otros|otro|ningun|desde|despues|al |en |con |sin |hay |hace |no |si[, ])/.test(text) || directObservation) && !text.includes('?');
    const matchedDetail = !text.includes('?') && question.detail.test(text) && text.length <= 250
      && (contextual || activeIntent || (!prediction.accepted && answerFragment));
    if (!shortAnswer && !matchedDetail) return null;
    if (/^(no se|no estoy segur[oa])[.!?\s]*$/.test(text)) {
      state.recovery.attempts += 1;
      if (state.recovery.attempts >= 2) return referUnclear(prediction, ['Contactar al taller', 'Nueva conversación']);
      return result('Está bien. No necesitas desmontarlo ni hacer pruebas que desconozcas. Podemos dejar esa comprobación pendiente para la revisión. Si sabes otro detalle del fallo, cuéntamelo.', state.issue, prediction, {
        actions: contact(), suggestions: ['Quiero solicitar una revisión', 'Nueva conversación'],
      });
    }
    if (state.pending.index === 1) {
      state.recovery = freshRecovery();
      state.details.respuesta_1 = text;
      state.stage = 'pregunta_2';
      state.pending = { kind: 'diagnostico', index: 2 };
      const second = typeof question.second === 'function' ? question.second(answerKind(text)) : question.second;
      return result(`Gracias. Seguimos con tu ${state.device}: ${second}`, state.issue, prediction, {
        suggestions: ['Sí', 'No', 'No estoy seguro'],
      });
    }
    state.details.respuesta_2 = text;
    state.recovery = freshRecovery();
    state.stage = 'orientacion';
    state.pending = null;
    if (state.issue === 'encendido' && answerKind(state.details.respuesta_1) !== 'no' && /\b(negra|sin imagen|no (?:da|muestra) imagen)\b/.test(text)) {
      return result('Ya hay señales de encendido, pero la pantalla sigue sin imagen. Anota ambos síntomas en el resumen y solicita una revisión de la pantalla o la salida de video.', state.issue, prediction, {
        actions: contact(), preserveText: true, suggestions: ['Nueva conversación'],
      });
    }
    return result(`Para tu ${state.device}, con el problema de ${LABELS[state.issue]}: ${pick(question.advice, state.turnCount)}\n\nEsto es orientación inicial, no un diagnóstico confirmado. Puedes copiar el resumen de esta conversación y compartirlo con el taller por Instagram.`, state.issue, prediction, {
      actions: contact(), suggestions: ['¿Cuánto costaría la revisión?', 'Nueva conversación'],
    });
  }

  function reply(raw, inspectPrediction) {
    const original = String(raw ?? '').trim();
    const text = normalize(original);
    if (/^(\/reset|reiniciar|reinicia|reinicia (la )?conversacion|reiniciar (la )?conversacion|nueva conversacion|nueva consulta|empezar de nuevo|borrar (el )?contexto)[.!?]*$/.test(text)) return reset();
    if (!text) return result('Escribe qué le pasa a tu equipo para poder orientarte.', 'aclaracion', { accepted: false });
    if (text.length > 1500) return result('Para poder revisar una consulta a la vez, resume el problema en menos de 1500 caracteres e indica qué equipo usas.', 'aclaracion', { accepted: false });
    state.turnCount += 1;
    state.history.push({ role: 'user', text: original, turn: state.turnCount });
    const device = detectDevice(text);
    const changedDevice = Boolean(device && state.device && device !== state.device);

    // Excepciones de seguridad explícitas, anteriores a la decisión estadística.
    const severe = /\b(humo|chispa|chispas|olor a quemado|huele a quemado|bateria (hinchada|inflada|abultada)|bateria se (hincho|inflo)|bateria esta (hinchada|inflada))\b/.test(text);
    const liquid = /\b(se (mojo|cayo al agua)|le (cayo|entro) (agua|liquido|cafe|refresco)|derrame|mojad[oa]|liquido dentro)\b/.test(text);
    if (severe) {
      state.recovery = freshRecovery();
      if (device) state.device = device;
      state.issue = 'temperatura'; state.stage = 'orientacion'; state.pending = null;
      state.details.alerta = original;
      return result('Detén el uso y no vuelvas a cargar el equipo. Si puedes hacerlo sin tocar partes calientes ni dañadas, desconecta la alimentación externa. No abras, presiones ni perfores la batería. Si hay fuego o peligro inmediato, aléjate y pide ayuda a los servicios de emergencia de tu localidad. El equipo necesita una revisión física.', 'seguridad', {}, { actions: contact(), safety: true });
    }
    if (liquid) {
      state.recovery = freshRecovery();
      if (device) state.device = device;
      state.issue = 'liquidos'; state.stage = 'orientacion'; state.pending = null;
      state.details.alerta = original;
      return liquidResponse();
    }

    const hints = competingSymptoms(text);
    const question = state.pending?.kind === 'diagnostico' ? activeQuestions() : null;
    const serviceQuery = /\b(cuanto (?:cuesta|cobran|sale)|precio|presupuesto|cotiza\w*|contact\w*|instagram|ubicaci[oó]n|ubicados|direcci[oó]n|horario)\b/.test(text);
    const explicitChange = changedDevice || /\b(otro problema|otra falla|otra consulta|cambiando de tema)\b/.test(text);
    const powerSignal = state.issue === 'encendido' && /\b(luz|luces|led|vibra|vibracion)\b/.test(text);
    const slotDetail = question?.detail.test(text) && (!text.includes('?') || powerSignal || technicalDescription(text));
    const related = Boolean(state.issue && !explicitChange && !serviceQuery && (
      isShortAnswer(text) || isDeviceOnly(text) || slotDetail
      || hints.includes(state.issue) || /\b(sigue igual|que hago|que sigue|no funciono|ya lo probe)\b/.test(text)
    ) && !hints.some(hint => hint !== state.issue && !question?.detail.test(text)));
    const contextual = related && state.turnCount > caseStart;
    // El vector usa mensajes del usuario. Las preguntas del bot solo guían el paso pendiente.
    const modelInput = contextual
      ? state.history.filter(row => row.role === 'user' && row.turn >= caseStart).map(row => row.text).join('\n')
      : original;
    let prediction;
    try { prediction = classifier.predict(modelInput, Boolean(inspectPrediction)) || {}; }
    catch { return result('No pude clasificar el mensaje. Intenta describir el síntoma y el tipo de equipo de nuevo.', 'desconocida', { accepted: false }); }
    inspectPrediction?.(prediction, classifier.thresholds, contextual);
    const intent = prediction.intent;
    if (device && (prediction.accepted || isDeviceOnly(text) || (!state.issue && technicalDescription(text)))) state.device = device;

    const hazardActive = state.issue === 'liquidos' || Boolean(state.details.alerta);
    const hazardousFollowup = /\b(conectar|conectarlo|conectarla|encender|encenderlo|encenderla|prender|prenderlo|cargar|cargarlo|funciona|probar|prueba|seco|seca|reinicia|reinicios|parpadea|parpadia)\b/.test(text);
    if (hazardActive && !changedDevice && (hazardousFollowup || (prediction.accepted && FAULTS.has(intent)))) {
      if (state.issue === 'liquidos') return liquidResponse(prediction);
      return result('Por la alerta que describiste, no sigas encendiendo ni cargando el equipo para probarlo. Mantén detenido su uso y solicita revisión física. No abras ni manipules la batería o partes calientes.', 'seguridad', prediction, { actions: contact(), safety: true });
    }

    // Una frase sin síntoma no aporta datos para iniciar una familia de fallas,
    // aunque un clasificador cerrado le asigne una probabilidad alta.
    if (/^(no funciona|no sirve|esta fallando|tengo un problema|algo no anda|falla algo)[.!?]*$/.test(text)) {
      const question = state.issue ? `Seguimos con ${LABELS[state.issue]} en tu ${state.device || 'equipo'}. ¿Qué ocurre exactamente y qué comprobación pudiste hacer?` : 'Dime qué equipo tienes y qué ocurre exactamente: por ejemplo, si no enciende, no carga o falla la pantalla.';
      return result(question, 'aclaracion', {...prediction, accepted: false}, {suggestions: BASIC_OPTIONS});
    }

    if (/^(contactar (?:al |con el )?taller|quiero contactar al taller)[.!?]*$/.test(text)) {
      if (state.recovery.description && !state.details.descripcion) state.details.descripcion = state.recovery.description;
      state.recovery = freshRecovery();
      if (['aclarar_sintoma','menu_falla'].includes(state.pending?.kind)) state.pending = null;
      return result('Puedes escribir a @yinyan_workshop en Instagram y compartir el resumen de lo que ocurre.', 'contacto', prediction, {actions:contact()});
    }
    const chosen = resolveChoice(text, prediction);
    if (chosen) return chosen;
    if (state.pending?.kind === 'aclarar_sintoma') {
      // Una consulta nueva reconocida puede salir del menú. Repetir el síntoma
      // o decir «sí» no confirma ninguna de las dos opciones.
      if (prediction.accepted && !isShortAnswer(text) && !isDeviceOnly(text) && !ambiguousSymptom(text)) {
        state.pending = null; state.recovery = freshRecovery();
      } else return askSymptom(prediction, original, changedDevice && technicalDescription(text));
    }
    if (!contextual && !hazardActive && ambiguousSymptom(text) && (state.details.variant !== ambiguousSymptom(text) || changedDevice)) return askSymptom(prediction, original);
    if (state.recovery.referred && (!prediction.accepted || isShortAnswer(text))) return referUnclear(prediction);

    if (!contextual && /^(si|sip|simon|afirmativo|correcto|claro|no|nop|negativo|todavia no|aun no|no se|no estoy segur[oa])[.!?\s]*$/.test(text) && state.pending?.kind !== 'diagnostico') {
      if (state.recovery.attempts > 0) return recoverUnknown({...prediction,accepted:false}, original);
      state.recovery.attempts = 1;
      if (!state.pending) state.pending = {kind:'menu_falla'};
      return result('Necesito una consulta completa para interpretar esa respuesta. Dime qué equipo tienes y qué falla presenta.', 'aclaracion', { ...prediction, accepted: false }, { suggestions: ['Mi computadora no enciende', 'Mi celular no carga'] });
    }

    // La entidad explícita responde a una pregunta de dispositivo, no a una
    // nueva clasificación de síntomas. El síntoma anterior permanece activo.
    if (state.pending?.kind === 'dispositivo' && device && isDeviceOnly(text)) {
      return askFirst(prediction);
    }

    if (state.pending?.kind === 'elegir_falla') {
      if (prediction.accepted && state.pending.candidates.includes(intent)) {
        state.pending = null;
        return beginFault(intent, prediction);
      }
      state.recovery.attempts += 1;
      if (state.recovery.attempts >= 2) return referUnclear(prediction, state.pending.candidates.map(item => LABELS[item]));
      return result(`¿Cuál revisamos primero: ${state.pending.candidates.map(item => LABELS[item]).join(' o ')}? Puedes usar uno de los botones.`, 'aclaracion', prediction, { suggestions: state.pending.candidates.map(item => LABELS[item]), actions:contact() });
    }

    if (!contextual && prediction.accepted && hints.length > 1 && /\b(y|ademas|tambien|pero)\b/.test(text)) {
      const multiple = hints;
      state.pending = { kind: 'elegir_falla', candidates: multiple };
      return result(`Mencionas varios síntomas. Para no mezclar las pruebas, ¿qué revisamos primero: ${multiple.map(item => LABELS[item]).join(' o ')}?`, 'aclaracion', prediction, { suggestions: multiple.map(item => LABELS[item]) });
    }

    if (explicitChange && prediction.accepted && FAULTS.has(intent) && intent !== 'liquidos') {
      caseStart = state.turnCount;
      state.details = {};
      return beginFault(intent, prediction);
    }

    if (contextual && question && powerSignal
        && (text.includes('?') || (state.pending.index === 2 && !/\b(pantalla|imagen|negra|enchufe|cargador)\b/.test(text)))) {
      let next = 'Me refiero a una luz indicadora del equipo. La vibración también cuenta como señal de encendido.';
      if (state.pending.index === 2) {
        next = answerKind(state.details.respuesta_1 || '') === 'no'
          ? 'Seguimos con la alimentación. Dime si pudiste probar otro enchufe y un cargador compatible.'
          : 'Ya registré la señal de encendido. Ahora fíjate si la pantalla muestra imagen.';
      }
      return result(next, state.issue, prediction, {preserveText: true});
    }
    // Una respuesta a la pregunta pendiente se procesa antes de abrir una falla distinta.
    const slot = !explicitChange && !serviceQuery && handleSlot(text, prediction, contextual);
    if (slot) return slot;

    // Una nueva falla clasificada tiene prioridad sobre el formulario anterior.
    if (!contextual && prediction.accepted && FAULTS.has(intent) && intent !== state.issue && !isShortAnswer(text)) {
      if (intent === 'liquidos') { state.issue = intent; state.stage = 'orientacion'; state.pending = null; return liquidResponse(prediction); }
      return beginFault(intent, prediction);
    }

    const contextualFollowup = /^(?:(?:y|ahora)\s+)*(que hago|que sigue|que puedo hacer|sigue igual|continua igual|no funciono|no mejoro|ya lo hice|ya lo probe|no sirvio)[.!?]*$/.test(text);
    if (contextualFollowup && state.issue && QUESTIONS[state.issue]) {
      if (state.pending?.kind === 'diagnostico') {
        const question = activeQuestions();
        const activeQuestion = state.pending.index === 1 ? question.first : (typeof question.second === 'function' ? question.second(answerKind(state.details.respuesta_1 || '')) : question.second);
        return result(`Seguimos con el problema de ${LABELS[state.issue]} en tu ${state.device}. Para continuar: ${activeQuestion}`, state.issue, prediction, { suggestions: ['Sí', 'No', 'No estoy seguro'] });
      }
      return result(`Si tu ${state.device || 'equipo'} sigue con el problema de ${LABELS[state.issue]} después de las comprobaciones, solicita revisión física. ${pick(activeQuestions().advice, state.turnCount)}`, state.issue, prediction, { actions: contact() });
    }

    if (contextual && state.pending?.kind === 'diagnostico') {
      return result('Seguimos con la misma falla. Dime qué observaste en la última comprobación.', state.issue, prediction, {preserveText: true});
    }
    if (contextual && state.stage === 'orientacion' && QUESTIONS[state.issue]) {
      return result('Si el problema sigue después de las comprobaciones, comparte el resumen con el taller para continuar la revisión.', state.issue, prediction, {actions: contact(), preserveText: true});
    }

    if (!prediction.accepted) {
      if (device && isDeviceOnly(text) && !state.issue) {
        if (state.recovery.attempts > 0) return recoverUnknown(prediction, original);
        state.recovery.attempts = 1; state.pending = {kind:'menu_falla'};
        return result(`Entendido: ${state.device}. ¿Qué falla presenta: no enciende, no carga, se calienta o tiene otro síntoma?`, 'aclaracion', prediction, {
          suggestions: BASIC_OPTIONS,
        });
      }
      return recoverUnknown(prediction, original);
    }

    if (FAULTS.has(intent)) {
      if (intent === 'liquidos') { state.issue = intent; state.stage = 'orientacion'; state.pending = null; return liquidResponse(prediction); }
      if (state.issue === intent && state.stage === 'orientacion') {
        return result(`Seguimos con ${LABELS[intent]} en tu ${state.device || 'equipo'}. ${pick(activeQuestions().advice, state.turnCount)} Si ya hiciste esas comprobaciones y continúa igual, hace falta una revisión física.`, intent, prediction, { actions: contact() });
      }
      return beginFault(intent, prediction);
    }

    if (['saludo','ayuda','despedida','contacto','presupuesto'].includes(intent)) {
      if (intent === 'contacto' && state.recovery.description && !state.details.descripcion) state.details.descripcion = state.recovery.description;
      state.recovery = freshRecovery();
      if (state.pending?.kind === 'menu_falla') state.pending = null;
    }
    if (intent === 'saludo') return result(pick([
      '¡Hola! Soy el asistente de YinYan Workshop. ¿Qué le pasa a tu computadora, celular o consola?',
      '¡Qué tal! Te ayudo con orientación inicial para tu equipo. Dime qué dispositivo tienes y qué está fallando.',
      'Bienvenido a YinYan Workshop. Cuéntame el síntoma y el tipo de equipo para empezar.',
    ], state.turnCount), intent, prediction, { suggestions: ['Mi computadora no enciende', 'Mi celular no carga', 'Mi consola se calienta'] });

    if (intent === 'despedida') return result(pick([
      'Gracias por consultar a YinYan Workshop. Puedes copiar el resumen si necesitas llevar tu equipo a revisión. Usa «Nueva conversación» para empezar otra consulta.',
      '¡Hasta luego! Conserva el resumen de la falla para compartirlo con el taller si lo necesitas.',
      'Aquí seguimos para orientarte. Si la falla persiste, contacta al taller y comparte lo que ya probaste.',
    ], state.turnCount), intent, prediction, { actions: contact() });

    if (intent === 'ayuda') return result(pick([
      'Puedo orientar sobre encendido, carga, temperatura, lentitud, internet, pantalla, audio, almacenamiento, software, controles y contacto con líquidos. Dime el equipo y un síntoma. No confirmo piezas dañadas ni presupuestos por chat.',
      'Empecemos con una falla a la vez. Por ejemplo: «mi celular no carga» o «mi computadora está lenta». Haré preguntas de seguimiento y te daré comprobaciones básicas sin desmontar el equipo.',
      'Soy un asistente de soporte inicial para computadoras, celulares y consolas. También puedo ayudarte a preparar un resumen para el taller. Para precios, horarios o disponibilidad, consulta directamente en Instagram.',
    ], state.turnCount), intent, prediction, { suggestions: ['Mi laptop no enciende', 'No tengo internet', 'Quiero contactar al taller'] });

    if (intent === 'presupuesto') return result(pick([
      'El costo depende del equipo, el diagnóstico y las piezas necesarias. No tengo una tarifa confirmada ni puedo emitir una cotización. Contacta a YinYan Workshop por Instagram y comparte el modelo y el resumen de la falla.',
      'Para cotizar hace falta conocer el modelo y revisar la falla. El taller debe confirmar precio, tiempos y disponibilidad. Puedes copiar el resumen de esta conversación y enviarlo por Instagram.',
      'No sería responsable inventar un precio por el síntoma. Solicita al taller una valoración y confirma el costo antes de autorizar cualquier reparación. Te dejo el contacto en Instagram.',
    ], state.turnCount), intent, prediction, { actions: contact(), suggestions: ['Quiero contactar al taller', 'Nueva conversación'] });

    if (intent === 'contacto') return result(pick([
      'Puedes contactar a YinYan Workshop en Instagram: @yinyan_workshop. El taller te confirmará ubicación, horario, disponibilidad y recepción del equipo. No tengo esos datos verificados.',
      'El canal de contacto disponible es @yinyan_workshop en Instagram. Pregunta directamente por el horario, dirección y cómo llevar tu equipo. Esta conversación no crea una cita ni una orden de servicio.',
      'Abre el perfil de Instagram de YinYan Workshop para coordinar la revisión. Comparte el tipo de equipo, modelo y resumen del síntoma; el taller confirmará los siguientes pasos.',
    ], state.turnCount), intent, prediction, { actions: contact() });

    return result('No pude determinar una respuesta adecuada. Cuéntame una falla concreta de tu computadora, celular o consola.', 'desconocida', { ...prediction, accepted: false });
  }

  function liquidResponse(prediction = {}) {
    return result(pick([
      'Si cayó líquido, deja de usarlo, apágalo si es posible sin riesgo y desconecta la alimentación externa. No lo cargues, no uses secadora y no lo metas en arroz. No intentes encenderlo para comprobar si funciona. Necesita revisión física cuanto antes.',
      'Un equipo mojado no debe volver a encenderse ni cargarse para probarlo. Desconecta solo lo que puedas hacer con seguridad, evita calor y arroz, y solicita revisión. No puedo evaluar corrosión o daño interno desde el chat.',
      'Prioriza detener el uso del equipo mojado. No conectes cargadores, no apliques calor y no intentes desmontar la batería. Evita el arroz y lleva el equipo a revisión; guardar los datos requiere evaluar antes su estado.',
    ], state.turnCount), 'liquidos', prediction, { actions: contact(), safety: true });
  }

  function getSummary() {
    const lines = [
      'YinYan Workshop · Resumen de orientación',
      `Equipo: ${state.device || 'no especificado'}`,
      `Síntoma: ${LABELS[state.issue] || 'no identificado'}`,
    ];
    if (state.details.descripcion) lines.push(`Descripción inicial: ${state.details.descripcion}`);
    if (state.recovery.description && state.recovery.description !== state.details.descripcion) lines.push(`Consulta por aclarar: ${state.recovery.description}`);
    if (state.details.variant) lines.push(`Detalle aclarado: ${state.details.variant === 'reinicios' ? 'se reinicia y aparece el logo' : 'parpadeo de pantalla'}`);
    if (state.details.respuesta_1) lines.push(`Primer seguimiento: ${state.details.respuesta_1}`);
    if (state.details.respuesta_2) lines.push(`Segundo seguimiento: ${state.details.respuesta_2}`);
    if (state.details.alerta) lines.push(`Alerta descrita: ${state.details.alerta}`);
    lines.push(`Mensajes del usuario: ${state.turnCount}`, 'Orientación inicial; no es un diagnóstico, cotización ni cita confirmada.');
    return lines.join('\n');
  }

  return { state, reply, reset, getSummary };
}
