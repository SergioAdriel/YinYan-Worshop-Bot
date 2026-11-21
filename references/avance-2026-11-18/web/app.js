import {loadClassifier} from './ml.js';
import {createConversation} from './dialogue.js';

const $ = id => document.getElementById(id);
const state = {
  manifest: null, day: 15, conversation: null, modelLoading: true, sending: false,
  custom: false, customResult: null, retryModel: null, examples: [], revision: '', storageReady: false,
  storageBusy: false, training: {status: 'idle'}, trainingReady: false, poll: null,
  author: 'alumno-a', sessionId: crypto.randomUUID(), queries: [], queriesBusy: false,
  pendingQueries: [], retryingQueries: false, reviewId: null, reviewBusy: false,
};
let toastTimer;
const TIMEZONE = 'America/Mexico_City';
const AUTHOR_KEY = 'yinyan-active-author';
const PENDING_KEY = 'yinyan-pending-queries-v1';
const dateFormatter = new Intl.DateTimeFormat('es-MX', {timeZone: TIMEZONE, dateStyle: 'medium', timeStyle: 'medium', hourCycle: 'h23'});
const dayFormatter = new Intl.DateTimeFormat('es-MX', {timeZone: TIMEZONE, dateStyle: 'long'});
const percentage = value => Number.isFinite(value) ? `${(value * 100).toLocaleString('es-MX', {maximumFractionDigits: 2})} %` : '—';
const label = intent => state.manifest?.labels?.[intent] || intent || 'Sin identificar';
const person = id => ({'alumno-a': 'Compañero A', 'alumno-b': 'Compañero B'}[id]) || state.manifest?.participants.find(item => item.id === id)?.name || id;
const currentDay = () => state.manifest?.days.find(item => item.day === state.day);
const timestamp = record => record.created_at || record.simulated_at;
function validDate(value) { const date = new Date(value || ''); return Number.isFinite(date.valueOf()) ? date : null; }
function dateText(value) { const date = validDate(value); return date ? `${dateFormatter.format(date)} · CDMX` : 'Sin fecha original'; }
function timeNode(record) {
  const time = node('time', '', dateText(timestamp(record)) + (record.timestamp_kind === 'simulated' || record.simulated === true ? ' · simulado' : ''));
  if (validDate(timestamp(record))) time.dateTime = timestamp(record);
  return time;
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4200);
}
function showView(view) {
  if (!['chat', 'queries', 'teach'].includes(view)) return;
  document.querySelectorAll('.view').forEach(element => { element.hidden = element.id !== `view-${view}`; });
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}
function refreshControls() {
  const modelBusy = state.modelLoading || state.sending;
  const unavailable = modelBusy || !state.conversation;
  for (const id of ['message-input', 'send-button', 'new-chat']) $(id).disabled = unavailable;
  document.querySelectorAll('[data-prompt], #suggestions button, .try-query').forEach(button => { button.disabled = unavailable; });
  $('copy-summary').disabled = unavailable || !state.conversation?.state.turnCount;
  const dayBusy = modelBusy || !state.manifest;
  $('day-select').disabled = dayBusy;
  $('previous-day').disabled = dayBusy || state.day <= 1;
  $('next-day').disabled = dayBusy || state.day >= 15;
  document.querySelectorAll('.chart-day').forEach(button => { button.disabled = dayBusy; });
  const storageDisabled = !state.storageReady || state.storageBusy || !state.manifest;
  for (const id of ['example-text', 'example-intent', 'save-example']) $(id).disabled = storageDisabled;
  document.querySelectorAll('.delete-example').forEach(button => { button.disabled = storageDisabled; });
  $('retry-storage').disabled = state.storageBusy;
  $('train-button').disabled = storageDisabled || state.modelLoading || !state.trainingReady || state.training.status === 'running' || !state.examples.length;
  $('use-custom-model').disabled = modelBusy || state.training.status === 'running' || !state.training.result?.model_url;
  $('active-author').disabled = state.sending || state.reviewBusy;
  $('retry-queries').disabled = state.retryingQueries;
  $('refresh-queries').disabled = state.queriesBusy;
  $('save-review').disabled = state.reviewBusy || !state.manifest;
  $('cancel-review').disabled = state.reviewBusy;
  document.querySelectorAll('.review-query').forEach(button => { button.disabled = state.reviewBusy || !state.manifest; });
}
function appendMessage(text, role = 'assistant', response = {}) {
  const row = node('div', `message ${role}${response.safety ? ' safety' : ''}`);
  row.append(node('div', 'sender', role === 'user' ? 'Tú' : 'Bot YinYan'), node('div', 'bubble', text));
  if (response.actions?.length) {
    const actions = node('div', 'message-actions');
    for (const action of response.actions) {
      try {
        const url = new URL(action.url);
        if (url.protocol !== 'https:') continue;
        const link = node('a', '', `${action.label} ↗`);
        link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
        actions.append(link);
      } catch { /* Invalid links are not offered. */ }
    }
    row.append(actions);
  }
  $('messages').append(row);
  $('chat-scroll').scrollTop = $('chat-scroll').scrollHeight;
}
function updateContext(response = {}) {
  const context = response.context || state.conversation?.state || {};
  $('context-device').textContent = context.device ? context.device.charAt(0).toUpperCase() + context.device.slice(1) : 'Por identificar';
  $('context-issue').textContent = context.issue ? label(context.issue) : 'Por identificar';
  $('suggestions').replaceChildren();
  for (const suggestion of (response.suggestions || []).slice(0, 4)) {
    const button = node('button', '', suggestion);
    button.type = 'button'; button.addEventListener('click', () => send(suggestion));
    $('suggestions').append(button);
  }
  refreshControls();
}
function resetConversation(focus = true) {
  if (!state.conversation) return;
  state.sessionId = crypto.randomUUID();
  const response = state.conversation.reset() || {};
  $('messages').replaceChildren();
  $('quick-start').hidden = false;
  $('message-input').value = '';
  $('query-save-status').textContent = 'Cada mensaje y su respuesta se guardan al enviarlos.';
  appendMessage(response.text || 'Hola. ¿Qué le pasa a tu computadora, celular o consola?');
  updateContext(response);
  if (focus) $('message-input').focus();
}
async function send(raw) {
  const text = raw.trim();
  if (!text || state.modelLoading || state.sending || !state.conversation) return;
  if (text.length > 1200) { toast('Escribe hasta 1,200 caracteres.'); return; }
  showView('chat'); state.sending = true; refreshControls();
  $('quick-start').hidden = true;
  appendMessage(text, 'user'); $('message-input').value = '';
  const author = state.author;
  try {
    await new Promise(resolve => requestAnimationFrame(resolve));
    let response;
    try { response = state.conversation.reply(text); }
    catch (error) {
      console.error('Consulta local:', error);
      response = {text: 'No pude procesar esa consulta. Intenta describir una sola falla o inicia una consulta nueva.', intent: 'desconocida', accepted: false};
    }
    appendMessage(response.text, 'assistant', response); updateContext(response);
    const query = {
      id: crypto.randomUUID(), session_id: state.sessionId, author, text, response: response.text,
      intent: response.intent || 'desconocida', accepted: Boolean(response.accepted),
      model: state.custom ? {kind: 'custom', revision: state.customResult?.revision || trainingRevision() || ''} : {kind: 'simulation', day: state.day},
    };
    if (response.resolution) query.resolution = response.resolution;
    $('query-save-status').textContent = 'Guardando consulta y respuesta…';
    try {
      const saved = await api('/api/queries', 'POST', query);
      $('query-save-status').textContent = `Consulta guardada · ${person(author)}${saved.query?.created_at ? ` · ${dateText(saved.query.created_at)}` : ''}`;
      await loadQueries();
    } catch (error) {
      state.pendingQueries.push(query);
      persistPendingQueries();
      renderPendingQueries(error.message);
      $('query-save-status').textContent = 'Consulta pendiente: aún no se ha guardado en el proyecto.';
    }
  } catch (error) {
    console.error('Consulta local:', error);
    toast('No se pudo completar la consulta. Revisa el aviso de guardado.');
  } finally {
    state.sending = false; refreshControls(); $('message-input').focus();
  }
}
function renderSnapshot() {
  const day = currentDay();
  const model = state.custom ? state.customResult : day;
  if (!model) return;
  $('chat-model-label').textContent = state.custom ? 'Mi modelo · entrenamiento local' : `Modelo local · Día ${state.day}`;
  $('snapshot-title').textContent = state.custom ? 'Mi modelo' : `Día ${state.day}`;
  const stale = state.custom && state.revision && state.customResult?.revision && state.customResult.revision !== state.revision;
  $('snapshot-description').textContent = state.custom ? `Modelo propio: día 15 más ejemplos del equipo.${stale ? ' Hay ejemplos pendientes de entrenar.' : ''}` : day.title;
  $('snapshot-examples').textContent = String(model.total_examples ?? '—');
  $('snapshot-result').textContent = `${model.correct ?? '—'} / ${model.total ?? '—'} · ${percentage(model.accuracy)}`;
}
function renderDay() {
  const day = currentDay();
  if (!day) return;
  $('day-select').value = String(state.day);
  $('day-note').textContent = day.note;
  $('day-accuracy').textContent = percentage(day.accuracy);
  $('day-score-caption').textContent = `${day.correct} de ${day.total} consultas`;
  $('detail-day-label').textContent = `DÍA ${day.day}`;
  $('detail-day-title').textContent = day.title;
  $('detail-count').textContent = `${day.total_examples} ejemplos acumulados · ${percentage(day.accuracy)} de aciertos`;
  $('day-added').textContent = `+${day.added_examples}`;
  $('day-query-count').textContent = `${day.queries.length} consultas`;
  document.querySelectorAll('.chart-day').forEach(button => {
    const active = Number(button.dataset.simulationDay) === day.day;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('#all-results tr').forEach(row => { row.classList.toggle('selected', Number(row.dataset.day) === day.day); });
  $('day-examples').replaceChildren();
  for (const example of day.examples) {
    const row = node('article', 'example-row');
    const meta = node('div', 'row-meta');
    meta.append(node('span', '', `${person(example.author)} · agregó un ejemplo`), timeNode({...example, simulated: true}));
    row.append(meta, node('p', 'record-text', example.text), node('span', 'intent-label', label(example.intent)));
    $('day-examples').append(row);
  }
  if (!day.examples.length) $('day-examples').append(node('p', 'empty-state', 'Ese día no se agregaron ejemplos.'));
  $('day-queries').replaceChildren();
  for (const query of day.queries) {
    const row = node('article', 'query-row');
    const meta = node('div', 'row-meta');
    meta.append(node('span', '', `${person(query.author)} · probó el bot`), node('span', `result-label${query.correct ? '' : ' wrong'}`, query.correct ? 'Acertó' : 'Se confundió'));
    meta.append(timeNode({...query, simulated: true}));
    const result = node('p', `query-result${query.correct ? '' : ' wrong'}`);
    result.append(document.createTextNode('Reconoció: '), node('strong', '', label(query.predicted)));
    if (!query.correct) result.append(document.createTextNode(` · Se esperaba: ${label(query.expected)}`));
    if (query.accepted === false) result.append(document.createTextNode(' · Pidió aclaración por confianza baja'));
    const button = node('button', 'text-button try-query', 'Probar esta consulta →');
    button.type = 'button';
    button.addEventListener('click', async () => {
      if (state.modelLoading || state.sending) return;
      if (state.custom) {
        const ready = await changeModel(day.model_url, false);
        if (!ready) return;
      }
      resetConversation(false); await send(query.text);
    });
    row.append(meta, node('p', 'record-text', query.text), result, button);
    $('day-queries').append(row);
  }
  renderSnapshot(); refreshControls();
}
function renderManifest() {
  const manifest = state.manifest;
  $('day-select').replaceChildren();
  for (const day of manifest.days) {
    const option = node('option', '', `Día ${day.day}`); option.value = String(day.day); $('day-select').append(option);
  }
  $('chart-goal').textContent = `Meta: ${percentage(manifest.target_accuracy)}`;
  $('evaluation-description').textContent = manifest.evaluation.description;
  $('participants').replaceChildren();
  for (const participant of manifest.participants) {
    const profile = node('article', `participant ${participant.role}`);
    const info = node('div'); info.append(node('strong', '', participant.name), node('p', '', participant.role === 'training' ? 'Aporta y corrige ejemplos' : 'Hace consultas de prueba'));
    const initials = participant.name.split(' ').map(word => word[0]).slice(0, 2).join('');
    profile.append(node('span', 'participant-avatar', initials), info); $('participants').append(profile);
  }
  $('example-intent').replaceChildren(); $('review-intent').replaceChildren();
  const choose = node('option', '', 'Selecciona la categoría'); choose.value = ''; $('review-intent').append(choose);
  for (const [intent, caption] of Object.entries(manifest.labels)) {
    const option = node('option', '', caption); option.value = intent; $('example-intent').append(option);
    const reviewOption = node('option', '', caption); reviewOption.value = intent; $('review-intent').append(reviewOption);
  }
  $('day-chart').replaceChildren(); $('all-results').replaceChildren();
  for (const day of manifest.days) {
    const button = node('button', 'chart-day'); button.type = 'button'; button.dataset.simulationDay = String(day.day);
    button.setAttribute('aria-label', `Día ${day.day}: ${percentage(day.accuracy)}, ${day.correct} de ${day.total} aciertos`);
    const bar = node('span', 'chart-bar'); bar.style.height = `${Math.max(0, Math.min(1, day.accuracy)) * 74}%`;
    button.append(node('span', 'bar-value', percentage(day.accuracy)), bar, node('span', 'bar-label', String(day.day)));
    button.addEventListener('click', () => selectDay(day.day)); $('day-chart').append(button);
    const row = node('tr'); row.dataset.day = String(day.day);
    for (const value of [day.day, day.total_examples, `${day.correct} / ${day.total}`, percentage(day.accuracy), percentage(day.precision_macro)]) row.append(node('td', '', String(value)));
    $('all-results').append(row);
  }
  renderDay();
}
async function selectDay(dayNumber) {
  if (state.modelLoading || state.sending || !state.manifest) return;
  const day = state.manifest.days.find(item => item.day === Number(dayNumber));
  if (!day) return;
  const previous = state.day;
  state.day = day.day;
  const ready = await changeModel(day.model_url, false);
  if (!ready) { state.day = previous; renderDay(); }
}
async function changeModel(url, custom) {
  const customSnapshot = custom ? {...state.training.result, revision: trainingRevision()} : null;
  state.modelLoading = true; refreshControls();
  $('model-status').className = 'model-status'; $('model-status').textContent = 'Cargando modelo…';
  $('model-error').hidden = true; state.retryModel = {url, custom, day: state.day};
  try {
    const classifier = await loadClassifier(url);
    state.conversation = createConversation(classifier, {concise: true});
    state.custom = custom;
    state.customResult = customSnapshot;
    $('model-status').textContent = custom ? 'Mi modelo local' : `Local · Día ${state.day}`;
    $('model-status').className = 'model-status ready';
    resetConversation(false); renderDay();
    return true;
  } catch (error) {
    state.conversation = null;
    $('model-status').className = 'model-status error'; $('model-status').textContent = 'No se pudo cargar';
    $('model-error-text').textContent = `No se pudo abrir el modelo. ${error.message} Mantén abierta la ventana de iniciar.cmd y vuelve a intentarlo.`;
    $('model-error').hidden = false;
    return false;
  } finally { state.modelLoading = false; refreshControls(); }
}
async function loadManifest() {
  state.modelLoading = true; refreshControls(); $('retry-model').disabled = true;
  try {
    const response = await fetch('./simulation/manifest.json', {cache: 'no-cache'});
    if (!response.ok) throw new Error(`Archivo de simulación no disponible (${response.status}).`);
    const manifest = await response.json();
    if (manifest.format_version !== 1 || manifest.simulated !== true || !Array.isArray(manifest.days) || manifest.days.length !== 15 || !Array.isArray(manifest.participants) || !manifest.labels) throw new Error('El formato de la simulación no es compatible.');
    state.manifest = manifest; renderManifest();
    await changeModel(currentDay().model_url, false); refreshControls();
  } catch (error) {
    $('model-status').className = 'model-status error'; $('model-status').textContent = 'Simulación no disponible';
    $('model-error-text').textContent = `No se pudo cargar la simulación. ${error.message} Ejecuta iniciar.cmd desde la carpeta completa del proyecto.`;
    $('model-error').hidden = false; state.modelLoading = false; refreshControls();
  } finally { $('retry-model').disabled = false; }
}
async function api(path, method = 'GET', body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, {method, cache: 'no-store', signal: controller.signal, headers: body === undefined ? {} : {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
    let data;
    try { data = await response.json(); }
    catch { throw new Error('El servidor local no devolvió datos válidos. Inicia el proyecto con iniciar.cmd.'); }
    if (!response.ok) throw new Error(data.error || `Error del servidor local (${response.status}).`);
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('El servidor tardó demasiado en responder. Reintenta en unos segundos.');
    throw error;
  } finally { clearTimeout(timeout); }
}
function persistPendingQueries() {
  try {
    if (state.pendingQueries.length) localStorage.setItem(PENDING_KEY, JSON.stringify(state.pendingQueries));
    else localStorage.removeItem(PENDING_KEY);
    state.pendingDurable = true;
  } catch { state.pendingDurable = false; }
}
function renderPendingQueries(reason = '') {
  $('query-save-error').hidden = state.pendingQueries.length === 0;
  if (state.pendingQueries.length) {
    $('query-save-error-text').textContent = `${state.pendingQueries.length} consulta(s) pendientes de guardar en el proyecto. ${state.pendingDurable === false ? 'No cierres esta pestaña: el navegador tampoco pudo conservar la copia pendiente.' : 'El navegador conserva una copia pendiente; vuelve a intentar el guardado.'}${reason ? ` ${reason}` : ''}`;
  }
  refreshControls();
}
async function retryPendingQueries() {
  if (state.retryingQueries || !state.pendingQueries.length) return;
  state.retryingQueries = true; refreshControls();
  let failure = '';
  try {
    while (state.pendingQueries.length) {
      await api('/api/queries', 'POST', state.pendingQueries[0]);
      state.pendingQueries.shift(); persistPendingQueries();
    }
    $('query-save-status').textContent = 'Las consultas pendientes ya se guardaron en el proyecto.';
    toast('Consultas guardadas.');
    await loadQueries();
  } catch (error) { failure = error.message; }
  finally { state.retryingQueries = false; renderPendingQueries(failure); }
}
function queryModelText(query) {
  return query.model?.kind === 'custom' ? 'Modelo propio' : `Práctica · día ${query.model?.day ?? '—'}`;
}
function renderQueries() {
  $('query-history').replaceChildren();
  if (!state.queries.length) {
    $('query-history').append(node('p', 'empty-state', 'Todavía no hay consultas guardadas. Escriban al bot desde Chat.'));
    return;
  }
  const days = new Map();
  const sorted = [...state.queries].sort((a, b) => (validDate(b.created_at)?.valueOf() || 0) - (validDate(a.created_at)?.valueOf() || 0));
  for (const query of sorted) {
    const date = validDate(query.created_at);
    const key = date ? dayFormatter.format(date) : 'Sin fecha original';
    if (!days.has(key)) days.set(key, new Map());
    const sessions = days.get(key);
    const session = query.session_id || query.id;
    if (!sessions.has(session)) sessions.set(session, []);
    sessions.get(session).push(query);
  }
  for (const [day, sessions] of days) {
    const section = node('section', 'history-day');
    section.append(node('h3', 'history-date', day));
    for (const queries of sessions.values()) {
      const session = node('section', 'card history-session');
      session.append(node('p', 'session-heading', `Conversación · ${queries.length} mensaje(s)`));
      for (const query of queries.reverse()) {
        const row = node('article', 'history-query'); row.dataset.id = query.id;
        const meta = node('div', 'row-meta');
        meta.append(node('span', '', `${person(query.author)} · ${queryModelText(query)}`), timeNode(query));
        const response = node('p', 'history-response');
        response.append(node('strong', '', 'Bot: '), document.createTextNode(query.response));
        row.append(meta, node('p', 'record-text', query.text), response);
        if (query.reviewed) row.append(node('span', 'reviewed-label', '✓ Revisada y guardada como ejemplo'));
        else {
          const button = node('button', 'button secondary small review-query', 'Usar para entrenar');
          button.type = 'button'; button.dataset.id = query.id;
          button.addEventListener('click', () => openReview(query));
          row.append(button);
        }
        session.append(row);
      }
      section.append(session);
    }
    $('query-history').append(section);
  }
  refreshControls();
}
async function loadQueries() {
  if (state.queriesBusy) return;
  state.queriesBusy = true; refreshControls();
  $('queries-status').textContent = 'Cargando consultas…';
  try {
    const data = await api('/api/queries');
    if (!Array.isArray(data.queries)) throw new Error('La lista de consultas no es válida.');
    state.queries = data.queries;
    renderQueries();
    $('queries-status').textContent = `${state.queries.length} consulta(s) guardadas · Hora de Ciudad de México`;
  } catch (error) {
    $('queries-status').textContent = `No se pudieron actualizar las consultas. ${error.message} Pulsa Actualizar para reintentar.`;
  } finally { state.queriesBusy = false; refreshControls(); }
}
const contextOnly = text => /^(s[ií]|no|ok|vale|no s[eé]|no estoy segur[oa]|celular|computadora|consola)[.!?]*$/i.test(text.trim());
function openReview(query) {
  if (!state.manifest || state.reviewBusy) return;
  state.reviewId = query.id;
  const needsContext = query.text.trim().length < 3 || contextOnly(query.text);
  $('review-text').value = needsContext ? '' : query.text;
  $('review-text').placeholder = needsContext ? `El mensaje «${query.text}» necesita contexto: escribe el equipo y su falla.` : 'Escribe una consulta completa.';
  $('review-intent').value = state.manifest.labels[query.intent] ? query.intent : '';
  $('review-author').textContent = `Revisa y agrega: ${person(state.author)}`;
  $('review-status').textContent = needsContext ? 'Una respuesta corta no enseña por sí sola. Completa la consulta con el contexto.' : '';
  $('review-dialog').showModal();
  $('review-text').focus();
}
async function saveReview(event) {
  event.preventDefault();
  if (state.reviewBusy || !state.reviewId) return;
  const text = $('review-text').value.trim();
  if (text.length < 3 || contextOnly(text)) {
    $('review-status').textContent = 'Escribe una consulta completa con el equipo y su falla.'; return;
  }
  const intent = $('review-intent').value;
  if (!state.manifest?.labels[intent]) { $('review-status').textContent = 'Selecciona la categoría correcta.'; return; }
  state.reviewBusy = true; refreshControls(); $('review-status').textContent = 'Guardando revisión…';
  try {
    await api(`/api/queries/${encodeURIComponent(state.reviewId)}/example`, 'POST', {text, intent, author: state.author});
    $('review-dialog').close(); state.reviewId = null;
    toast('Revisión guardada como ejemplo. Entrena para que el bot la use.');
    await Promise.allSettled([loadQueries(), loadStorage()]);
  } catch (error) { $('review-status').textContent = error.message; }
  finally { state.reviewBusy = false; refreshControls(); }
}
function restoreBrowserState() {
  try {
    const author = localStorage.getItem(AUTHOR_KEY);
    if (['alumno-a', 'alumno-b'].includes(author)) state.author = author;
    const saved = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    if (Array.isArray(saved)) state.pendingQueries = saved.filter(query => query && typeof query.id === 'string' && typeof query.text === 'string' && typeof query.response === 'string');
    state.pendingDurable = true;
  } catch { state.pendingDurable = false; }
  $('active-author').value = state.author;
  $('example-author-label').textContent = person(state.author);
  renderPendingQueries();
}
function storageError(message) {
  $('storage-error-text').textContent = message; $('storage-error').hidden = false;
}
function applyExamples(data) {
  if (!Array.isArray(data.examples)) throw new Error('La lista de ejemplos del servidor no es válida.');
  state.examples = data.examples; state.revision = data.revision || ''; state.storageReady = true;
  $('storage-error').hidden = true; renderSavedExamples(); renderTraining();
}
function renderSavedExamples() {
  $('saved-count').textContent = String(state.examples.length);
  $('saved-empty').hidden = state.examples.length > 0;
  $('saved-empty').textContent = 'Todavía no han agregado ejemplos. Empiecen con una frase y su categoría correcta.';
  $('saved-examples').replaceChildren();
  for (const example of state.examples) {
    const row = node('article', 'saved-row');
    const content = node('div'); const meta = node('div', 'saved-meta');
    meta.append(node('span', '', person(example.author)), node('span', 'intent-label', label(example.intent)), timeNode(example));
    if (example.source_query_id) meta.append(node('span', '', 'Consulta revisada'));
    content.append(node('p', 'record-text', example.text), meta);
    const button = node('button', 'delete-example', 'Borrar'); button.type = 'button'; button.dataset.id = example.id;
    button.setAttribute('aria-label', `Borrar ejemplo: ${example.text.slice(0, 50)}`);
    button.addEventListener('click', () => mutateExamples(`/api/examples/${encodeURIComponent(example.id)}`, 'DELETE', {author: state.author}, 'Ejemplo borrado. Entrena de nuevo para reflejar el cambio.'));
    row.append(content, button); $('saved-examples').append(row);
  }
  refreshControls();
}
async function loadStorage() {
  if (state.storageBusy) return;
  state.storageBusy = true; refreshControls();
  const results = await Promise.allSettled([api('/api/examples'), api('/api/training')]);
  if (results[0].status === 'fulfilled') {
    try { applyExamples(results[0].value); }
    catch (error) { state.storageReady = false; storageError(error.message); }
  } else { state.storageReady = false; storageError(`No se pudieron cargar los ejemplos. ${results[0].reason.message}`); }
  if (results[1].status === 'fulfilled') {
    state.training = results[1].value; state.trainingReady = true; renderTraining(); schedulePoll();
  } else {
    state.trainingReady = false; $('training-status').textContent = `No se pudo consultar el entrenamiento. ${results[1].reason.message}`;
    storageError('No se pudo consultar el estado del entrenamiento. Comprueba el servidor y pulsa Reintentar.');
  }
  state.storageBusy = false; refreshControls();
}
async function mutateExamples(path, method, body, message) {
  if (state.storageBusy || !state.storageReady) return false;
  state.storageBusy = true; refreshControls(); $('example-status').textContent = 'Guardando…';
  try {
    const data = await api(path, method, body); applyExamples(data);
    try {
      state.training = await api('/api/training'); state.trainingReady = true;
      renderTraining(); schedulePoll();
    } catch {
      // The examples were saved; a later retry can recover training state.
      state.trainingReady = false;
      storageError('Los ejemplos se guardaron, pero no se pudo actualizar el estado del entrenamiento. Pulsa Reintentar.');
    }
    $('example-status').textContent = message; toast(message); return true;
  } catch (error) {
    $('example-status').textContent = error.message; storageError(error.message); return false;
  } finally { state.storageBusy = false; refreshControls(); }
}
function trainingRevision() {
  return state.training.trained_revision ?? state.training.result?.revision ?? state.training.result?.examples_revision ?? state.training.revision;
}
function renderTraining() {
  const training = state.training;
  let message = training.message || ({idle: 'Agreguen ejemplos y luego entrenen el modelo.', running: 'Entrenando en esta computadora…', succeeded: 'Entrenamiento terminado.', failed: 'No se pudo completar el entrenamiento.'}[training.status]) || 'Estado de entrenamiento desconocido.';
  if (training.status === 'succeeded' && trainingRevision() && state.revision && trainingRevision() !== state.revision) message += ' Cambiaron los ejemplos desde el último entrenamiento. Vuelve a entrenar para incluir esos cambios.';
  $('training-status').textContent = message;
  const result = training.result;
  $('custom-results').hidden = !result?.model_url;
  if (result) {
    $('custom-accuracy').textContent = percentage(result.accuracy);
    $('custom-correct').textContent = `${result.correct ?? '—'} / ${result.total ?? '—'}`;
    $('custom-examples').textContent = String(result.total_examples ?? '—');
    $('custom-trained-at').textContent = dateText(training.trained_at || result.trained_at);
  }
  renderSnapshot();
  refreshControls();
}
function schedulePoll() {
  clearTimeout(state.poll);
  if (state.training.status !== 'running') return;
  state.poll = setTimeout(async () => {
    try {
      state.training = await api('/api/training'); state.trainingReady = true; renderTraining();
      if (state.training.status === 'succeeded') toast('Entrenamiento terminado. Ya puedes probar tu modelo.');
      schedulePoll();
    } catch (error) {
      state.trainingReady = false; $('training-status').textContent = `No se pudo consultar el avance. ${error.message}`;
      storageError('No se pudo consultar el entrenamiento. Pulsa Reintentar para recuperar el estado.'); refreshControls();
    }
  }, 1200);
}
async function train() {
  if (state.modelLoading || state.storageBusy || state.training.status === 'running' || !state.trainingReady || !state.examples.length) return;
  state.training = {status: 'running', message: 'Iniciando el entrenamiento local…'}; renderTraining();
  try {
    state.training = await api('/api/train', 'POST', {}); renderTraining(); schedulePoll();
  } catch (error) {
    state.training = {status: 'failed', message: error.message}; renderTraining();
    storageError(`No se pudo iniciar el entrenamiento. ${error.message}`);
  }
}
function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const link = node('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function copySummary() {
  if (!state.conversation) return;
  const text = state.conversation.getSummary();
  try { await navigator.clipboard.writeText(text); toast('Resumen copiado.'); }
  catch { download('consulta-yinyan.txt', text, 'text/plain;charset=utf-8'); toast('Se descargó el resumen.'); }
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  showView(button.dataset.view);
  if (button.dataset.view === 'queries') loadQueries();
  if (button.dataset.view === 'teach') loadStorage();
}));
document.querySelectorAll('[data-open-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.openView)));
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => send(button.dataset.prompt)));
$('chat-form').addEventListener('submit', event => { event.preventDefault(); send($('message-input').value); });
$('message-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(event.currentTarget.value); } });
$('new-chat').addEventListener('click', () => resetConversation());
$('copy-summary').addEventListener('click', copySummary);
$('active-author').addEventListener('change', event => {
  state.author = event.target.value;
  $('example-author-label').textContent = person(state.author);
  try { localStorage.setItem(AUTHOR_KEY, state.author); }
  catch { toast('La identidad se usará en esta pestaña; el navegador no pudo conservar la selección.'); }
  if (state.conversation?.state.turnCount) resetConversation(false);
});
$('refresh-queries').addEventListener('click', loadQueries);
$('retry-queries').addEventListener('click', retryPendingQueries);
$('review-form').addEventListener('submit', saveReview);
$('cancel-review').addEventListener('click', () => $('review-dialog').close());
$('review-dialog').addEventListener('cancel', event => { if (state.reviewBusy) event.preventDefault(); });
$('day-select').addEventListener('change', event => selectDay(Number(event.target.value)));
$('previous-day').addEventListener('click', () => selectDay(state.day - 1));
$('next-day').addEventListener('click', () => selectDay(state.day + 1));
$('retry-model').addEventListener('click', () => {
  if (!state.manifest) { loadManifest(); return; }
  if (state.modelLoading) return;
  if (state.retryModel) state.day = state.retryModel.day;
  changeModel(state.retryModel?.url || currentDay().model_url, state.retryModel?.custom || false);
});
$('retry-storage').addEventListener('click', loadStorage);
$('example-form').addEventListener('submit', async event => {
  event.preventDefault();
  const text = $('example-text').value.trim();
  if (text.length < 3) { $('example-status').textContent = 'Escribe una consulta de al menos 3 caracteres antes de guardar.'; return; }
  const saved = await mutateExamples('/api/examples', 'POST', {text, intent: $('example-intent').value, author: state.author}, 'Ejemplo guardado. Entrena para que el bot lo use.');
  if (saved) { $('example-text').value = ''; $('example-text').focus(); }
});
$('train-button').addEventListener('click', train);
$('use-custom-model').addEventListener('click', async () => {
  if (state.modelLoading || !state.training.result?.model_url) return;
  const ready = await changeModel(state.training.result.model_url, true);
  if (ready) { showView('chat'); toast('Estás probando tu modelo. El selector de días vuelve a la simulación.'); }
});

restoreBrowserState();
await Promise.allSettled([loadManifest(), loadStorage(), loadQueries()]);
// Storage may load before participant labels; render it once the manifest is ready.
if (state.storageReady) renderSavedExamples();
