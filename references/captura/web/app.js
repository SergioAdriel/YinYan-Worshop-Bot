import {loadClassifier} from './ml.js';
import {createConversation} from './dialogue.js';

const $ = id => document.getElementById(id);
const state = {
  manifest: null, day: 15, conversation: null, modelLoading: true, sending: false,
  custom: false, customResult: null, retryModel: null, examples: [], revision: '', storageReady: false,
  storageBusy: false, training: {status: 'idle'}, trainingReady: false, poll: null,
  author: 'alumno-a', sessionId: crypto.randomUUID(), queries: [], queriesBusy: false,
  pendingQueries: [], retryingQueries: false, reviewId: null, reviewBusy: false,
  approvedRevision: '', editingId: null, versions: [], activeVersionId: null,
  loadedVersionId: null, modelDescriptor: null, progress: null, versionsBusy: false,
  progressBusy: false, versionBusy: false, selectedVersionId: null, activeReady: false,
};
let toastTimer;
const TIMEZONE = 'America/Mexico_City';
const AUTHOR_KEY = 'yinyan-active-author';
const PENDING_KEY = 'yinyan-pending-queries-v1';
const dateFormatter = new Intl.DateTimeFormat('es-MX', {timeZone: TIMEZONE, dateStyle: 'medium', timeStyle: 'medium', hourCycle: 'h23'});
const dayFormatter = new Intl.DateTimeFormat('es-MX', {timeZone: TIMEZONE, dateStyle: 'long'});
const percentage = value => Number.isFinite(value) ? `${(value * 100).toLocaleString('es-MX', {maximumFractionDigits: 2})} %` : '—';
const label = intent => state.manifest?.labels?.[intent] || intent || 'Sin identificar';
const PEOPLE = {'alumno-a': 'Erick Mendoza Mendoza', 'alumno-b': 'Daniel Gibran Luciano Tellez', sergio: 'Sergio Adriel Muñoz Camarena', raynier: 'Raynier Jetsahe Torres Flores', system: 'Verificación del sistema'};
const person = id => PEOPLE[id] || state.manifest?.participants.find(item => item.id === id)?.name || id;
const historicalPerson = id => state.manifest?.participants.find(item => item.id === id)?.name || id;
const modelName = id => ({naive_bayes:'Naive Bayes', logistic_regression:'Regresión logística'}[id]) || id || '—';
const statusName = status => ({pending:'Pendiente',approved:'Aprobado',rejected:'Rechazado',running:'En curso',succeeded:'Completada',failed:'Fallida',provisional:'Provisional',active:'Activa',historical:'Histórica'}[status]) || status || 'Pendiente';
const shortened = value => typeof value === 'string' ? value.slice(0, 12) : '—';
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
  if (!['chat', 'queries', 'teach', 'versions', 'progress'].includes(view)) return;
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
  document.querySelectorAll('.example-action').forEach(button => { button.disabled = storageDisabled; });
  $('retry-storage').disabled = state.storageBusy;
  $('train-button').disabled = storageDisabled || !state.trainingReady || state.training.status === 'running' || state.versionBusy;
  $('use-custom-model').disabled = modelBusy || state.training.status === 'running' || !state.training.result?.model_url;
  $('active-author').disabled = state.sending || state.reviewBusy;
  $('retry-queries').disabled = state.retryingQueries;
  $('refresh-queries').disabled = state.queriesBusy;
  $('save-review').disabled = state.reviewBusy || !state.manifest;
  $('cancel-review').disabled = state.reviewBusy;
  document.querySelectorAll('.review-query').forEach(button => { button.disabled = state.reviewBusy || !state.manifest; });
  $('refresh-versions').disabled = state.versionsBusy || state.versionBusy;
  $('refresh-progress').disabled = state.progressBusy;
  $('restore-active-model').disabled = modelBusy || state.versionBusy;
  $('cancel-edit').disabled = storageDisabled;
  document.querySelectorAll('.version-action').forEach(button => { button.disabled = state.versionBusy || state.modelLoading || state.sending; });
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
      model: state.loadedVersionId ? {kind:'version', version_id:state.loadedVersionId} : state.custom ? {kind: 'custom', revision: state.customResult?.revision || trainingRevision() || ''} : {kind: 'simulation', day: state.day},
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
  const descriptor = state.modelDescriptor;
  const version = descriptor?.version;
  const model = version ? {...(version.models?.[version.selected_model] || {}), total_examples:version.counts?.total} : state.custom ? state.customResult : day;
  if (!model) return;
  const preview = descriptor?.preview;
  $('chat-model-label').textContent = version ? `${preview ? 'Vista previa' : 'Modelo activo'} · Jornada ${version.journey} · ${modelName(version.selected_model)}` : `${preview ? 'Referencia histórica' : 'Modelo activo de referencia'} · Etapa ${state.day}`;
  $('snapshot-title').textContent = version ? `Jornada ${version.journey}${preview ? ' · previa' : ' · activa'}` : `Referencia · etapa ${state.day}`;
  const stale = version?.dataset_version && state.approvedRevision && version.approved_revision && version.approved_revision !== state.approvedRevision;
  $('snapshot-description').textContent = version ? `${modelName(version.selected_model)} · ${dateText(version.finished_at || version.created_at)}${stale ? ' Hay datos aprobados posteriores.' : ''}` : 'Base inicial de 240 ejemplos. Las jornadas nuevas se conservan por separado.';
  $('restore-active-model').hidden = !preview;
  $('snapshot-examples').textContent = String(model.total_examples ?? '—');
  $('snapshot-result').textContent = `${model.correct ?? '—'} / ${model.total ?? version?.counts?.test ?? '—'} · ${percentage(model.accuracy)}`;
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
    meta.append(node('span', '', `${historicalPerson(example.author)} · agregó un ejemplo`), timeNode({...example, simulated: true}));
    row.append(meta, node('p', 'record-text', example.text), node('span', 'intent-label', label(example.intent)));
    $('day-examples').append(row);
  }
  if (!day.examples.length) $('day-examples').append(node('p', 'empty-state', 'Ese día no se agregaron ejemplos.'));
  $('day-queries').replaceChildren();
  for (const query of day.queries) {
    const row = node('article', 'query-row');
    const meta = node('div', 'row-meta');
    meta.append(node('span', '', `${historicalPerson(query.author)} · probó el bot`), node('span', `result-label${query.correct ? '' : ' wrong'}`, query.correct ? 'Acertó' : 'Se confundió'));
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
async function changeModel(url, custom, descriptor = null) {
  const customSnapshot = custom ? {...state.training.result, revision: trainingRevision()} : null;
  state.modelLoading = true; refreshControls();
  $('model-status').className = 'model-status'; $('model-status').textContent = 'Cargando modelo…';
  $('model-error').hidden = true; state.retryModel = {url, custom, day: state.day};
  try {
    const classifier = await loadClassifier(url);
    state.conversation = createConversation(classifier, {concise: true});
    state.custom = custom;
    state.customResult = customSnapshot;
    state.modelDescriptor = descriptor || {preview:true, source:'history'};
    state.loadedVersionId = descriptor?.version?.id || descriptor?.active_id || null;
    $('model-status').textContent = descriptor?.version ? `${descriptor.preview ? 'Vista previa' : 'Activo'} · Jornada ${descriptor.version.journey}` : `${state.modelDescriptor.preview ? 'Referencia' : 'Activo'} · Etapa ${state.day}`;
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
    await loadActiveModel(); refreshControls();
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
  return query.model?.kind === 'version' ? `Versión ${shortened(query.model.version_id)}` : query.model?.kind === 'custom' ? 'Modelo propio anterior' : `Referencia · etapa ${query.model?.day ?? '—'}`;
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
        if (query.reviewed) row.append(node('span', 'reviewed-label', '✓ Registrada como ejemplo; consulta su estado en Ejemplos'));
        else {
          const button = node('button', 'button secondary small review-query', 'Preparar ejemplo');
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
    toast('Ejemplo pendiente guardado. Revísalo y apruébalo antes de entrenar.');
    await Promise.allSettled([loadQueries(), loadStorage()]);
  } catch (error) { $('review-status').textContent = error.message; }
  finally { state.reviewBusy = false; refreshControls(); }
}
function restoreBrowserState() {
  try {
    const author = localStorage.getItem(AUTHOR_KEY);
    if (Object.hasOwn(PEOPLE, author) && author !== 'system') state.author = author;
    const saved = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    if (Array.isArray(saved)) state.pendingQueries = saved.filter(query => query && typeof query.id === 'string' && typeof query.text === 'string' && typeof query.response === 'string');
    state.pendingDurable = true;
  } catch {state.pendingDurable = false;}
  $('active-author').value = state.author;
  updateAuthor(); renderPendingQueries();
}
function updateAuthor() {
  $('example-author-label').textContent = person(state.author);
  $('author-role').textContent = ['sergio', 'raynier'].includes(state.author)
    ? 'Desarrollo: integración, entrenamiento y evaluación.' : 'Datos: incorporación de ejemplos, etiquetas y revisión.';
}
function storageError(message) {$('storage-error-text').textContent = message; $('storage-error').hidden = false;}
function applyExamples(data) {
  if (!Array.isArray(data.examples)) throw new Error('La lista de ejemplos del servidor no es válida.');
  state.examples = data.examples; state.revision = data.revision || '';
  state.approvedRevision = data.approved_revision || '';
  state.storageReady = true; $('storage-error').hidden = true;
  $('dataset-version').textContent = `Versión de ejemplos aprobados: ${shortened(state.approvedRevision || data.dataset_version)}`;
  renderSavedExamples(); renderTraining();
}
function actionButton(text, className, action) {
  const button = node('button', `button secondary small ${className}`, text);
  button.type = 'button'; button.addEventListener('click', action); return button;
}
function renderSavedExamples() {
  $('saved-count').textContent = String(state.examples.filter(row => row.review_status === 'approved' && !row.review_conflict).length);
  const filter = $('example-filter').value;
  const examples = state.examples.filter(row => filter === 'all' || (row.review_status || 'pending') === filter);
  $('saved-empty').hidden = examples.length > 0;
  $('saved-empty').textContent = state.examples.length ? 'No hay ejemplos en este estado.' : 'Todavía no hay ejemplos nuevos. Guarda una expresión; quedará pendiente de revisión.';
  $('saved-examples').replaceChildren();
  for (const example of [...examples].reverse()) {
    const row = node('article', 'saved-row'); row.dataset.id = example.id;
    const content = node('div'); const meta = node('div', 'saved-meta');
    const status = example.review_status || 'pending';
    meta.append(node('span', '', person(example.author)), node('span', 'intent-label', label(example.intent)), timeNode(example), node('span', `review-badge ${status}`, statusName(status)));
    if (example.source_query_id) meta.append(node('span', '', 'Desde una consulta'));
    if (example.reviewed_by) meta.append(node('span', '', `Revisó: ${person(example.reviewed_by)} · ${dateText(example.reviewed_at)}`));
    content.append(node('p', 'record-text', example.text), meta, node('p', 'record-version small muted', `Registro ${shortened(example.id)} · dataset ${shortened(example.dataset_version)}`));
    if (example.review_conflict) content.append(node('p', 'form-status', 'Hay revisiones en conflicto. Revisa el texto y la categoría antes de resolver su estado.'));
    const actions = node('div', 'row-actions');
    if (status === 'pending') {
      actions.append(actionButton('Editar', 'example-action edit-example', () => editExample(example)),
        actionButton('Aprobar', 'example-action approve-example', () => reviewExample(example, 'approved')),
        actionButton('Rechazar', 'example-action reject-example', () => reviewExample(example, 'rejected')),
        actionButton('Eliminar', 'example-action delete-example', () => mutateExamples(`/api/examples/${encodeURIComponent(example.id)}`, 'DELETE', {author:state.author, record_version:example.record_version}, 'Registro pendiente retirado; se conserva su trazabilidad.')));
    } else actions.append(actionButton('Reabrir', 'example-action reopen-example', () => reviewExample(example, 'pending')));
    for (const button of actions.children) button.dataset.id = example.id;
    row.append(content, actions); $('saved-examples').append(row);
  }
  refreshControls();
}
function editExample(example) {
  if (state.storageBusy || example.review_status !== 'pending') return;
  state.editingId = example.id; state.editingVersion = example.record_version;
  $('example-form-title').textContent = 'Editar ejemplo pendiente';
  $('example-text').value = example.text; $('example-intent').value = example.intent;
  $('save-example').textContent = 'Guardar cambios'; $('cancel-edit').hidden = false;
  showView('teach'); $('example-text').focus(); $('example-form').scrollIntoView({block:'center'});
}
function cancelEdit() {
  state.editingId = null; state.editingVersion = null; $('example-form').reset();
  $('example-form-title').textContent = 'Agregar un ejemplo'; $('save-example').textContent = 'Guardar pendiente';
  $('cancel-edit').hidden = true;
}
async function reviewExample(example, review_status) {
  const messages = {approved:'Ejemplo aprobado. Se incorporará a la próxima jornada.', rejected:'Ejemplo rechazado. Se conserva y queda fuera del entrenamiento.', pending:'Ejemplo reabierto como pendiente; queda fuera del próximo entrenamiento.'};
  await mutateExamples(`/api/examples/${encodeURIComponent(example.id)}/review`, 'POST',
    {author:state.author, review_status, record_version:example.record_version}, messages[review_status]);
}
async function loadStorage() {
  if (state.storageBusy) return;
  state.storageBusy = true; refreshControls();
  const results = await Promise.allSettled([api('/api/examples'), api('/api/training')]);
  if (results[0].status === 'fulfilled') {
    try {applyExamples(results[0].value);} catch(error) {state.storageReady=false; storageError(error.message);}
  } else {state.storageReady=false; storageError(`No se pudieron cargar los ejemplos. ${results[0].reason.message}`);}
  if (results[1].status === 'fulfilled') {
    state.training=results[1].value; state.trainingReady=true; renderTraining(); schedulePoll();
  } else {
    state.trainingReady=false; $('training-status').textContent=`No se pudo consultar el entrenamiento. ${results[1].reason.message}`;
  }
  state.storageBusy=false; refreshControls();
  await Promise.allSettled([loadProgress(), loadVersions()]);
}
async function mutateExamples(path, method, body, message) {
  if (state.storageBusy || !state.storageReady) return false;
  state.storageBusy=true; refreshControls(); $('example-status').textContent='Guardando…';
  try {
    applyExamples(await api(path, method, body));
    state.training=await api('/api/training'); state.trainingReady=true; renderTraining(); schedulePoll();
    $('example-status').textContent=message; toast(message);
    await loadProgress(); return true;
  } catch(error) {$('example-status').textContent=error.message; storageError(error.message); return false;}
  finally {state.storageBusy=false; refreshControls();}
}
function trainingRevision() {return state.training.trained_revision ?? state.training.result?.approved_revision ?? state.training.revision;}
function summaryMetrics(version) {return version?.models?.[version.selected_model] || version?.metrics || version || {};}
function versionById(id) {return state.versions.find(version => version.id === id);}
function renderTraining() {
  const training=state.training;
  let message=training.message || ({idle:'Puedes entrenar con la base y los ejemplos aprobados.',running:'Entrenando dos clasificadores…',succeeded:'Jornada completada: revisa la versión provisional.',failed:'La jornada falló. El modelo activo se conserva.'}[training.status]) || 'Estado no disponible.';
  if (training.stale) message+=' Hay cambios aprobados posteriores a esa instantánea.';
  $('training-status').textContent=message;
  const result=training.result;
  const candidate=versionById(result?.id || result?.run_id || training.run_id);
  const version=candidate?.status==='succeeded' ? candidate : null;
  const model=version ? summaryMetrics(version) : result;
  $('custom-results').hidden=!result;
  if (model) {
    $('custom-accuracy').textContent=percentage(model.accuracy);
    $('custom-correct').textContent=`${model.correct ?? '—'} / ${model.total ?? version?.counts?.test ?? '—'}`;
    $('custom-examples').textContent=String(version?.counts?.total ?? result?.total_examples ?? '—');
    $('custom-trained-at').textContent=dateText(version?.finished_at || training.trained_at || result?.trained_at);
  }
  renderSnapshot(); refreshControls();
}
function schedulePoll() {
  clearTimeout(state.poll);
  if (state.training.status !== 'running') return;
  state.poll=setTimeout(async () => {
    try {
      state.training=await api('/api/training'); state.trainingReady=true; renderTraining();
      if (state.training.status !== 'running') {
        await Promise.allSettled([loadVersions(),loadProgress()]);
        if (state.training.status === 'succeeded') toast('Jornada terminada. La versión queda provisional hasta que la activen.');
      }
      schedulePoll();
    } catch(error) {state.trainingReady=false; $('training-status').textContent=`No se pudo consultar el avance. ${error.message}`; refreshControls();}
  },1500);
}
async function train() {
  if (state.storageBusy || state.training.status === 'running' || !state.trainingReady) return;
  state.training={status:'running',message:'Preparando una nueva jornada con datos aprobados…'}; renderTraining();
  try {state.training=await api('/api/train','POST',{author:state.author}); renderTraining(); await loadVersions(); schedulePoll();}
  catch(error) {state.training={status:'failed',message:error.message}; renderTraining();}
}
async function loadActiveModel() {
  try {
    const active=await api('/api/models/active');
    if (!active.model_url) throw new Error('El servidor no indicó la ruta del modelo activo.');
    state.activeVersionId=active.active_id || null;
    const version=active.version || (active.active_id ? versionById(active.active_id) : null);
    const ready=await changeModel(active.model_url, Boolean(active.active_id), {...active,version,preview:false});
    state.activeReady=ready; return ready;
  } catch(error) {
    state.activeReady=false; state.modelLoading=false; state.conversation=null;
    $('model-status').className='model-status error'; $('model-status').textContent='Modelo activo sin verificar';
    $('model-error-text').textContent=`No se pudo consultar el modelo activo. ${error.message} Pulsa Reintentar para recuperar la versión aprobada.`;
    $('model-error').hidden=false; state.retryModel={active:true}; refreshControls(); return false;
  }
}
async function loadVersions() {
  if (state.versionsBusy) return;
  state.versionsBusy=true; refreshControls();
  try {
    const data=await api('/api/versions');
    if (!Array.isArray(data.versions)) throw new Error('El historial de versiones no es válido.');
    state.versions=data.versions; state.activeVersionId=data.active_id || null;
    if (state.loadedVersionId && state.loadedVersionId !== state.activeVersionId && state.modelDescriptor) state.modelDescriptor.preview=true;
    renderVersions(); renderSnapshot(); renderTraining();
    $('versions-status').textContent=`${state.versions.length} jornada(s) registradas. ${state.activeVersionId ? 'El chatbot utiliza la versión aprobada indicada.' : 'La referencia inicial sigue activa; todavía no se ha activado una jornada.'}`;
    if (state.selectedVersionId) {
      const version=versionById(state.selectedVersionId);
      if (version) renderVersionDetails(version);
    }
  } catch(error) {$('versions-status').textContent=`No se pudo leer el historial. ${error.message}`;}
  finally {state.versionsBusy=false; refreshControls();}
}
function renderVersions() {
  $('version-history').replaceChildren();
  if (!state.versions.length) {$('version-history').append(node('p','empty-state','Todavía no hay jornadas nuevas. Entrenar modelo creará la primera con fecha y hora reales.')); return;}
  for (const version of [...state.versions].sort((a,b)=>(b.journey || 0)-(a.journey || 0))) {
    const row=node('article','card version-row'); row.dataset.id=version.id;
    const status=version.id===state.activeVersionId ? 'active' : version.status==='succeeded' ? (version.approval_status==='approved' ? 'historical' : 'provisional') : version.status;
    const content=node('div'); content.append(node('h3','',`Jornada ${version.journey} · ${statusName(status)}`),
      node('p','small',`${dateText(version.created_at || version.started_at)} · Responsable: ${person(version.author || version.created_by || 'system')}`),
      node('p','small muted',`Versión ${shortened(version.id)} · dataset ${shortened(version.dataset_version)} · ${modelName(version.selected_model)}`));
    const metric=summaryMetrics(version);
    if (version.status==='succeeded') content.append(node('p','small',`${version.counts?.total ?? '—'} ejemplos · F1 macro ${percentage(metric.f1_macro)} · accuracy ${percentage(metric.accuracy)} (desarrollo)`));
    if (version.status==='failed') content.append(node('p','form-status',version.error || version.message || 'El entrenamiento no se completó.'));
    const actions=node('div','row-actions');
    actions.append(actionButton('Ver resultados','version-action view-version',()=>showVersion(version.id)));
    if (version.status==='succeeded') {
      actions.append(actionButton('Probar sin activar','version-action preview-version',()=>previewVersion(version)));
      if (version.id!==state.activeVersionId) actions.append(actionButton(version.approval_status==='approved' ? 'Recuperar como activa' : 'Aprobar y activar','version-action activate-version',()=>activateVersion(version)));
    }
    for (const button of actions.children) button.dataset.id=version.id;
    row.append(content,actions); $('version-history').append(row);
  }
  refreshControls();
}
function metricTable(models, cv={}) {
  const wrapper=node('div','table-scroll'); const table=node('table');
  const head=node('thead'); const heading=node('tr');
  for (const caption of ['Modelo','F1 macro CV','Accuracy','Precision macro','Recall macro','F1 macro']) heading.append(node('th','',caption));
  head.append(heading); table.append(head); const body=node('tbody');
  for (const [name,metrics] of Object.entries(models || {})) {
    const row=node('tr');
    for (const value of [modelName(name),percentage(cv[name]?.f1_macro_mean),percentage(metrics.accuracy),percentage(metrics.precision_macro),percentage(metrics.recall_macro),percentage(metrics.f1_macro)]) row.append(node('td','',value));
    body.append(row);
  }
  table.append(body); wrapper.append(table); return wrapper;
}
function confusionMatrix(name, matrix, labels) {
  const details=node('details','matrix-details'); details.append(node('summary','',`Matriz de confusión · ${modelName(name)}`));
  details.append(node('p','small muted','Filas: intención real. Columnas: predicción. Desliza la tabla para consultar todas las categorías.'));
  const wrapper=node('div','table-scroll'); const table=node('table','matrix-table'); const head=node('thead'); const headings=node('tr');
  headings.append(node('th','','Real / predicha'));
  for (const intent of labels) headings.append(node('th','',label(intent)));
  head.append(headings); table.append(head); const body=node('tbody');
  matrix.forEach((values,index)=>{const row=node('tr'); row.append(node('th','',label(labels[index]))); values.forEach((value,column)=>row.append(node('td',index===column ? 'diagonal' : '',String(value)))); body.append(row);});
  table.append(body); wrapper.append(table); details.append(wrapper); return details;
}
function renderVersionDetails(version) {
  $('version-detail').hidden=false;
  $('version-detail-title').textContent=`Jornada ${version.journey} · ${statusName(version.status)}`;
  $('version-detail-meta').textContent=`${version.id} · dataset ${version.dataset_version || '—'} · ${dateText(version.finished_at || version.created_at)}`;
  const content=$('version-detail-content'); content.replaceChildren();
  if (version.status!=='succeeded') {content.append(node('p','form-status',version.error || version.message || 'Esta ejecución todavía no tiene resultados completos.')); return;}
  content.append(node('p','',`Seleccionado por validación: ${modelName(version.selected_model)}. ${version.id===state.activeVersionId ? 'Esta es la versión activa.' : 'Consultar estos resultados no cambia el chatbot.'}`),
    node('p','small muted','La selección usa F1 macro de validación cruzada. Las otras cuatro métricas corresponden al benchmark conocido de desarrollo.'),metricTable(version.models,version.cv));
  if (version.comparison?.previous_id) {
    const comparison=version.comparison;
    content.append(node('h4','','Comparación con la jornada anterior'),node('p','small',`Anterior: ${shortened(comparison.previous_id)} · Cambio de accuracy: ${percentage(comparison.accuracy_delta)} · Cambio de F1 macro: ${percentage(comparison.f1_macro_delta)}. Las diferencias pertenecen al benchmark de desarrollo.`));
  }
  const labels=version.labels || Object.keys(state.manifest?.labels || {}).sort();
  for (const [name,metrics] of Object.entries(version.models || {})) if (Array.isArray(metrics.confusion_matrix)) content.append(confusionMatrix(name,metrics.confusion_matrix,labels));
  content.append(node('h4','','Errores observados'));
  const errors=(version.errors || []).filter(row=>!row.model || row.model===version.selected_model);
  const chosen=[],seen=new Set();
  for (const error of errors) {if (!seen.has(error.expected)) {chosen.push(error); seen.add(error.expected);} if (chosen.length===3) break;}
  for (const error of errors) {if (chosen.length===3) break; if (!chosen.includes(error)) chosen.push(error);}
  if (!chosen.length) content.append(node('p','small muted','No se registraron errores en esta evaluación. Eso no garantiza generalización a consultas reales.'));
  for (const error of chosen) {
    const row=node('article','observed-error'); row.append(node('p','record-text',error.text),node('p','small',`Esperada: ${label(error.expected)} · Predicha: ${label(error.predicted)}`),node('p','small muted',error.interpretation || 'La clasificación confundió ambas intenciones. Revisa el vocabulario y el contexto de esta expresión.')); content.append(row);
  }
  const actions=node('div','row-actions');
  actions.append(actionButton('Probar sin activar','version-action preview-version',()=>previewVersion(version)));
  if (version.id!==state.activeVersionId) actions.append(actionButton('Aprobar y activar esta versión','version-action activate-version',()=>activateVersion(version)));
  content.append(node('p','small muted','Activar cambia el modelo del chatbot y conserva la versión anterior para recuperarla. El servidor verifica los archivos y las comprobaciones antes de hacer el cambio.'),actions);
  const final=node('section','final-evaluation'); final.append(node('h4','','Evaluación final reservada'),node('p','small','La prueba final requiere al menos 50 consultas independientes. Se utiliza de forma controlada y no sirve para elegir reiteradamente entre modelos. La misma evaluación ya registrada puede recuperarse.'));
  const finalCount=state.progress?.final_test_size || 0;
  const evaluate=actionButton('Evaluar prueba final reservada','final-test-button',()=>evaluateFinal(version));
  evaluate.disabled=finalCount<50 || state.versionBusy || version.id!==state.activeVersionId;
  final.append(node('p','small muted',`${finalCount} consultas disponibles. ${version.id!==state.activeVersionId ? 'Activa la versión elegida antes de evaluar.' : finalCount<50 ? 'Pendiente de datos independientes.' : 'Al ejecutar se registra que esta prueba fue consultada.'}`),evaluate);
  if (version.final_evaluation) final.append(metricTable({[version.selected_model]:version.final_evaluation.metrics || version.final_evaluation}));
  content.append(final); refreshControls();
}
async function showVersion(id) {
  try {const version=await api(`/api/versions/${encodeURIComponent(id)}`); state.selectedVersionId=id; renderVersionDetails(version); showView('versions'); $('version-detail').scrollIntoView({block:'start'});}
  catch(error) {$('versions-status').textContent=error.message;}
}
async function previewVersion(version) {
  if (state.versionBusy || state.modelLoading || state.sending) return;
  const ready=await changeModel(version.model_url || `/api/versions/${encodeURIComponent(version.id)}/model.json`,true,{version,preview:true});
  if (ready) {showView('chat'); toast('Vista previa: el modelo activo guardado no cambió.');}
}
async function activateVersion(version) {
  if (state.versionBusy || state.training.status==='running') return;
  state.versionBusy=true; refreshControls(); $('versions-status').textContent='Verificando y activando la versión…';
  try {
    await api(`/api/versions/${encodeURIComponent(version.id)}/activate`,'POST',{author:state.author});
    await Promise.allSettled([loadVersions(),loadProgress()]);
    if (!await loadActiveModel()) throw new Error('La aprobación se guardó, pero no se pudo cargar el modelo activo. Pulsa Reintentar.');
    toast(`Jornada ${version.journey} activa. La versión anterior se conserva.`);
  } catch(error) {$('versions-status').textContent=error.message;}
  finally {state.versionBusy=false; refreshControls();}
}
async function evaluateFinal(version) {
  if (state.versionBusy) return;
  state.versionBusy=true; refreshControls();
  try {
    const evaluation=await api(`/api/versions/${encodeURIComponent(version.id)}/evaluate-final`,'POST',{author:state.author});
    toast('Evaluación final registrada. No se incorporaron sus consultas al entrenamiento.');
    await showVersion(version.id); await loadProgress();
    const result=evaluation.metrics || evaluation.result?.metrics || evaluation;
    if (Number.isFinite(result.accuracy)) $('version-detail-content').append(node('p','form-status',`Evaluación final: accuracy ${percentage(result.accuracy)} · F1 macro ${percentage(result.f1_macro)}`));
  } catch(error) {$('versions-status').textContent=error.message;}
  finally {state.versionBusy=false; refreshControls(); if (state.selectedVersionId) await showVersion(state.selectedVersionId);}
}
async function loadProgress() {
  if (state.progressBusy) return;
  state.progressBusy=true; refreshControls();
  try {state.progress=await api('/api/progress'); renderProgress(); $('progress-status').textContent='Estado actualizado desde los registros locales.';}
  catch(error) {$('progress-status').textContent=`No se pudo actualizar el progreso. ${error.message}`;}
  finally {state.progressBusy=false; refreshControls();}
}
function renderProgress() {
  const progress=state.progress; if (!progress) return;
  const counts=progress.counts || {};
  const intentCount=Number.isInteger(progress.intents) ? progress.intents : Array.isArray(progress.intents) ? progress.intents.length : Object.keys(progress.intents || state.manifest?.labels || {}).length;
  $('progress-counters').replaceChildren();
  for (const [caption,value] of [['Ejemplos de base',counts.base],['Total guardado',counts.total],['Aprobados nuevos',counts.approved_additional],['Listos para entrenar',counts.approved],['Pendientes',counts.pending],['Rechazados',counts.rejected],['Faltan para el mínimo',progress.missing_examples_total],['Intenciones',intentCount]]) {
    const card=node('div','card progress-counter'); card.append(node('strong','',String(value ?? '—')),node('span','',caption)); $('progress-counters').append(card);
  }
  $('progress-intents').replaceChildren();
  for (const item of progress.per_intent || []) {
    const row=node('tr');
    const approvedAdditional=item.approved_additional ?? Math.max(0,(item.approved || 0)-(item.base || 0));
    for (const value of [label(item.intent),item.base,approvedAdditional,item.pending,item.rejected,item.missing]) row.append(node('td',item.missing>0 ? 'needs-data' : '',String(value ?? '—')));
    $('progress-intents').append(row);
  }
  const active=progress.active?.version || progress.active;
  const last=progress.last_training;
  $('progress-model').replaceChildren();
  for (const [caption,value] of [['Intenciones disponibles',intentCount],['Versión del dataset',progress.dataset_version || '—'],['Modelo activo',active?.selected_model ? modelName(active.selected_model) : 'Naive Bayes de referencia'],['Versión activa',active?.id || state.activeVersionId || 'Base inicial'],['Último entrenamiento',last ? dateText(last.finished_at || last.created_at || last.started_at) : 'Todavía no hay jornadas nuevas'],['Benchmark de desarrollo',80],['Prueba final reservada',`${progress.final_test_size ?? 0} / mínimo 50 consultas`]]) {
    const row=node('div'); row.append(node('dt','',caption),node('dd','',String(value))); $('progress-model').append(row);
  }
  $('rubric-status').replaceChildren();
  for (const requirement of progress.rubric || []) {
    const row=node('article','rubric-row'); row.append(node('strong','',requirement.title || requirement.id),node('span','review-badge',requirement.status),node('p','small muted',Array.isArray(requirement.evidence) ? requirement.evidence.join(' · ') : String(requirement.evidence || ''))); $('rubric-status').append(row);
  }
}
function download(filename, content, type) {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const link=node('a'); link.href=url; link.download=filename; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function copySummary() {
  if (!state.conversation) return;
  const text=state.conversation.getSummary();
  try {await navigator.clipboard.writeText(text); toast('Resumen copiado.');}
  catch {download('consulta-yinyan.txt',text,'text/plain;charset=utf-8'); toast('Se descargó el resumen.');}
}
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{
  showView(button.dataset.view);
  if (button.dataset.view==='queries') loadQueries();
  if (button.dataset.view==='teach') loadStorage();
  if (button.dataset.view==='versions') loadVersions();
  if (button.dataset.view==='progress') loadProgress();
}));
document.querySelectorAll('[data-open-view]').forEach(button=>button.addEventListener('click',()=>{showView(button.dataset.openView); if (button.dataset.openView==='teach') loadStorage();}));
document.querySelectorAll('[data-prompt]').forEach(button=>button.addEventListener('click',()=>send(button.dataset.prompt)));
$('chat-form').addEventListener('submit',event=>{event.preventDefault(); send($('message-input').value);});
$('message-input').addEventListener('keydown',event=>{if (event.key==='Enter' && !event.shiftKey && !event.isComposing) {event.preventDefault(); send(event.currentTarget.value);}});
$('new-chat').addEventListener('click',()=>resetConversation());
$('copy-summary').addEventListener('click',copySummary);
$('active-author').addEventListener('change',event=>{
  state.author=event.target.value; updateAuthor();
  try {localStorage.setItem(AUTHOR_KEY,state.author);} catch {toast('La selección se usará en esta pestaña; no se pudo conservar en el navegador.');}
  if (state.conversation?.state.turnCount) resetConversation(false);
});
$('refresh-queries').addEventListener('click',loadQueries);
$('refresh-versions').addEventListener('click',loadVersions);
$('refresh-progress').addEventListener('click',loadProgress);
$('restore-active-model').addEventListener('click',loadActiveModel);
$('retry-queries').addEventListener('click',retryPendingQueries);
$('review-form').addEventListener('submit',saveReview);
$('cancel-review').addEventListener('click',()=>$('review-dialog').close());
$('review-dialog').addEventListener('cancel',event=>{if (state.reviewBusy) event.preventDefault();});
$('day-select').addEventListener('change',event=>selectDay(Number(event.target.value)));
$('previous-day').addEventListener('click',()=>selectDay(state.day-1));
$('next-day').addEventListener('click',()=>selectDay(state.day+1));
$('retry-model').addEventListener('click',()=>state.manifest ? loadActiveModel() : loadManifest());
$('retry-storage').addEventListener('click',loadStorage);
$('example-filter').addEventListener('change',renderSavedExamples);
$('cancel-edit').addEventListener('click',cancelEdit);
$('example-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const input={text:$('example-text').value.trim(),intent:$('example-intent').value,author:state.author};
  if (state.editingId) {
    input.record_version=state.editingVersion;
    if (await mutateExamples(`/api/examples/${encodeURIComponent(state.editingId)}`,'PATCH',input,'Cambios guardados; el ejemplo sigue pendiente de aprobación.')) cancelEdit();
  } else if (await mutateExamples('/api/examples','POST',input,'Ejemplo pendiente guardado. Revísalo y apruébalo antes de entrenar.')) $('example-text').value='';
});
$('train-button').addEventListener('click',train);
$('use-custom-model').addEventListener('click',async()=>{
  await loadVersions(); const id=state.training.result?.id || state.training.result?.run_id || state.training.run_id || state.versions.find(row=>row.status==='succeeded')?.id;
  if (id) showVersion(id); else showView('versions');
});
restoreBrowserState();
await Promise.allSettled([loadManifest(),loadStorage(),loadQueries()]);
if (state.pendingQueries.length) retryPendingQueries();
