'use strict';

const MAX_OFFERS = 200;
const REFRESH_MS = 3 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const CLOCK_SKEW_MS = 15 * 60 * 1000;
const SEEN_KEY = 'caccia-offerte-errori-visti';
const DISMISS_KEY = 'caccia-offerte-avvisi-nascosti';

const KNOWN_CATEGORIES = [
  ['Elettronica e informatica', 'Elettronica'],
  ['Casa ed elettrodomestici', 'Casa'],
  ['Videogiochi e console', 'Videogiochi'],
];

const euroFmt = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
});

const state = {
  data: null,
  loadError: false,
  checkedAt: null,
  categoria: 'tutte',
  tipo: 'tutte',
  sort: 'recenti',
  scontoMin: 0,
};

let seq = 0;
let lastAttempt = 0;
let notifyReady = false;

document.addEventListener('DOMContentLoaded', init);

function init() {
  document.getElementById('refresh').addEventListener('click', () => load(true));
  bindChips();
  document.getElementById('sconto').addEventListener('input', () => {
    updateSliderLabel();
    renderView();
  });
  updateSliderLabel();
  load(false);
  setInterval(() => {
    if (document.visibilityState !== 'hidden') load(false);
  }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastAttempt >= REFRESH_MS) {
      load(false);
    }
  });
  setInterval(tickTimes, 30000);
}

async function load(manual) {
  const mySeq = ++seq;
  lastAttempt = Date.now();
  if (manual) setRefreshing(true);
  const list = document.getElementById('list');
  list.setAttribute('aria-busy', 'true');
  try {
    const url = new URL('data/offerte.json', window.location.href);
    url.searchParams.set('t', String(Date.now()));
    const res = await fetch(url.href, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (mySeq !== seq) return;
    state.data = normalize(json);
    state.loadError = false;
    state.checkedAt = new Date();
    if (!selectedCategoryStillExists()) {
      state.categoria = 'tutte';
      syncPressed(document.getElementById('categoria-chips'), 'data-categoria', 'tutte');
    }
    clearSoftError();
    ensureCategoryChips();
    renderMeta();
    renderView();
    watchErrors(state.data.offerte);
    document.documentElement.classList.add('is-loaded');
    if (!notifyReady) {
      notifyReady = true;
      setupNotify();
    }
  } catch (err) {
    if (mySeq !== seq) return;
    console.error('Caccia Offerte:', err);
    if (state.data) {
      showSoftError();
    } else {
      state.loadError = true;
      document.documentElement.classList.add('is-loaded');
      renderView();
    }
  } finally {
    if (mySeq === seq) {
      list.setAttribute('aria-busy', 'false');
      setRefreshing(false);
    }
  }
}

function normalize(input) {
  let data = input;
  if (Array.isArray(data)) data = { aggiornato: '', offerte: data };
  if (!data || typeof data !== 'object') throw new Error('formato');
  const list = Array.isArray(data.offerte) ? data.offerte : [];
  const offers = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const trovata = typeof item.trovata_il === 'string' ? item.trovata_il : '';
    const parsed = Date.parse(trovata);
    offers.push({
      id: item.id == null ? '' : String(item.id),
      titolo: typeof item.titolo === 'string' && item.titolo.trim()
        ? item.titolo.trim()
        : 'Offerta senza titolo',
      url: typeof item.url === 'string' ? item.url.trim() : '',
      immagine: typeof item.immagine === 'string' ? item.immagine.trim() : '',
      categoria: typeof item.categoria === 'string' ? item.categoria.trim() : '',
      prezzo: toNumber(item.prezzo),
      prezzo_abituale: toNumber(item.prezzo_abituale),
      minimo_storico: toNumber(item.minimo_storico),
      sconto: toNumber(item.sconto_percentuale),
      tipo: typeof item.tipo === 'string' ? item.tipo : '',
      venditore: typeof item.venditore === 'string' ? item.venditore.trim() : '',
      nota: typeof item.nota === 'string' ? item.nota.trim() : '',
      trovata_il: trovata,
      trovataMs: Number.isNaN(parsed) ? NaN : parsed,
    });
  }
  offers.sort(byNewest);
  return {
    aggiornato: typeof data.aggiornato === 'string' ? data.aggiornato : '',
    offerte: offers.slice(0, MAX_OFFERS),
  };
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.trim().replace(/\s/g, '').replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function byNewest(a, b) {
  const am = Number.isFinite(a.trovataMs) ? a.trovataMs : -Infinity;
  const bm = Number.isFinite(b.trovataMs) ? b.trovataMs : -Infinity;
  return bm - am;
}

function selectedCategoryStillExists() {
  if (state.categoria === 'tutte') return true;
  return state.data.offerte.some((offer) => offer.categoria === state.categoria);
}

function viewOffers() {
  const items = state.data.offerte.filter((offer) => {
    if (state.categoria !== 'tutte' && offer.categoria !== state.categoria) return false;
    if (state.tipo !== 'tutte' && offer.tipo !== state.tipo) return false;
    if ((offer.sconto ?? 0) < state.scontoMin) return false;
    return true;
  });
  if (state.sort === 'sconto') {
    items.sort((a, b) => (b.sconto ?? -Infinity) - (a.sconto ?? -Infinity) || byNewest(a, b));
  } else {
    items.sort(byNewest);
  }
  return items;
}

function renderMeta() {
  const time = document.getElementById('updated');
  const iso = state.data.aggiornato;
  if (!iso || Number.isNaN(Date.parse(iso))) {
    time.textContent = 'non disponibile';
    time.removeAttribute('datetime');
  } else {
    time.setAttribute('datetime', iso);
    time.textContent = formatRome(iso);
  }
  const checked = document.getElementById('checked');
  checked.textContent = state.checkedAt
    ? 'Controllato alle ' + formatRomeTime(state.checkedAt) + ' (Roma)'
    : '';
}

function renderView() {
  const stateBox = document.getElementById('state');
  const list = document.getElementById('list');
  const count = document.getElementById('count');

  if (!state.data) {
    if (!state.loadError) return;
    list.replaceChildren();
    count.textContent = '';
    stateBox.hidden = false;
    stateBox.replaceChildren(errorCard());
    return;
  }

  const visible = viewOffers();
  const fresh = visible.filter((offer) => isFresh(offer.trovataMs)).length;
  count.textContent = countLabel(visible.length, fresh);

  if (!state.data.offerte.length) {
    list.replaceChildren();
    stateBox.hidden = false;
    stateBox.replaceChildren(emptyDataCard());
    return;
  }
  if (!visible.length) {
    list.replaceChildren();
    stateBox.hidden = false;
    stateBox.replaceChildren(emptyFilterCard());
    return;
  }
  stateBox.hidden = true;
  stateBox.replaceChildren();
  list.replaceChildren(...visible.map(renderCard));
}

function countLabel(n, fresh) {
  if (n === 0) return 'Nessuna offerta';
  const base = n === 1 ? '1 offerta' : n + ' offerte';
  if (!fresh) return base;
  return fresh === 1 ? base + " · 1 nell'ultima ora" : base + " · " + fresh + " nell'ultima ora";
}

function renderCard(offer) {
  const li = document.createElement('li');
  li.className = 'card';
  if (isFresh(offer.trovataMs)) li.classList.add('card--fresh');
  if (offer.tipo === 'errore_prezzo') li.classList.add('card--error');
  const body = el('div', { class: 'card-body' });
  body.append(
    renderTags(offer),
    el('h2', null, offer.titolo),
    renderPrices(offer),
    renderMetaRow(offer)
  );
  if (offer.nota) body.append(el('p', { class: 'nota' }, offer.nota));
  body.append(renderAmazon(offer));
  li.append(renderMedia(offer), body);
  return li;
}

function renderMedia(offer) {
  const media = el('div', { class: 'card-media' });
  const badge = formatSconto(offer.sconto);
  if (badge) media.append(el('span', { class: 'discount' }, badge));
  const src = safeUrl(offer.immagine);
  if (!src) {
    addPlaceholder(media, offer.categoria);
    return media;
  }
  const img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  img.src = src;
  img.addEventListener('error', () => {
    img.remove();
    addPlaceholder(media, offer.categoria);
  });
  media.append(img);
  return media;
}

function addPlaceholder(media, categoria) {
  media.classList.add('is-placeholder');
  if (media.querySelector('.ph')) return;
  media.append(el('span', { class: 'ph' }, shortCategory(categoria || 'Offerta')));
}

function renderTags(offer) {
  const tags = el('div', { class: 'tags' });
  if (offer.categoria) tags.append(el('span', { class: 'tag' }, offer.categoria));
  if (offer.tipo === 'errore_prezzo') {
    tags.append(el('span', { class: 'badge-error' }, 'Possibile errore di prezzo'));
  }
  if (isFresh(offer.trovataMs)) tags.append(el('span', { class: 'badge-fresh' }, 'Ultima ora'));
  return tags;
}

function renderPrices(offer) {
  const wrap = el('p', { class: 'prices' });
  const price = el('span', { class: 'price' });
  price.append(
    el('span', { class: 'sr-only' }, 'Prezzo attuale '),
    document.createTextNode(offer.prezzo == null ? 'Prezzo non disponibile' : euroFmt.format(offer.prezzo))
  );
  wrap.append(price);
  if (offer.prezzo_abituale != null) {
    const usual = document.createElement('s');
    usual.className = 'usual';
    usual.append(
      el('span', { class: 'sr-only' }, 'Prezzo abituale '),
      document.createTextNode(euroFmt.format(offer.prezzo_abituale))
    );
    wrap.append(usual);
  }
  return wrap;
}

function renderMetaRow(offer) {
  const row = el('p', { class: 'meta' });
  const found = el('span', { class: 'found' });
  const time = document.createElement('time');
  if (offer.trovata_il) time.setAttribute('datetime', offer.trovata_il);
  if (Number.isFinite(offer.trovataMs)) time.dataset.ms = String(offer.trovataMs);
  time.textContent = tempoFa(offer.trovataMs);
  if (offer.trovata_il && !Number.isNaN(Date.parse(offer.trovata_il))) {
    time.title = formatRome(offer.trovata_il) + ' (Roma)';
  }
  found.append(document.createTextNode('Trovata '), time);
  row.append(found);
  if (offer.venditore) row.append(el('span', null, 'Venduto da ' + offer.venditore));
  if (offer.minimo_storico != null) {
    row.append(el('span', null, 'Minimo storico ' + euroFmt.format(offer.minimo_storico)));
  }
  return row;
}

function renderAmazon(offer) {
  const href = safeUrl(offer.url);
  if (!href) return el('p', { class: 'no-link' }, 'Link non disponibile');
  const link = document.createElement('a');
  link.className = 'btn amazon';
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener';
  link.append(document.createTextNode('Vedi su Amazon'), externalIcon());
  return link;
}

function externalIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M14 5h5v5M19 5l-9 9M17 13v5H6V7h5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

function errorCard() {
  const button = el('button', { type: 'button', class: 'btn' }, 'Riprova');
  button.addEventListener('click', () => {
    document.documentElement.classList.remove('is-loaded');
    state.loadError = false;
    document.getElementById('state').hidden = true;
    document.getElementById('count').textContent = 'Caricamento offerte…';
    load(true);
  });
  return el(
    'div',
    { class: 'state-card' },
    el('h2', null, 'Impossibile caricare le offerte'),
    el('p', null, 'Il file data/offerte.json non risponde oppure non è un JSON valido.'),
    button
  );
}

function emptyDataCard() {
  return el(
    'div',
    { class: 'state-card' },
    el('h2', null, 'Nessuna offerta al momento'),
    el('p', null, "Il file dei dati è vuoto. Viene aggiornato in automatico circa ogni quarto d'ora.")
  );
}

function emptyFilterCard() {
  const button = el('button', { type: 'button', class: 'btn' }, 'Azzera filtri');
  button.addEventListener('click', resetFilters);
  return el(
    'div',
    { class: 'state-card' },
    el('h2', null, 'Nessuna offerta corrisponde ai filtri'),
    el('p', null, 'Prova ad abbassare lo sconto minimo o a cambiare categoria e tipo.'),
    button
  );
}

function bindChips() {
  document.getElementById('categoria-chips').addEventListener('click', (event) => {
    const button = event.target.closest('[data-categoria]');
    if (!button) return;
    state.categoria = button.dataset.categoria;
    syncPressed(button.parentElement, 'data-categoria', state.categoria);
    renderView();
  });
  document.getElementById('tipo-chips').addEventListener('click', (event) => {
    const button = event.target.closest('[data-tipo]');
    if (!button) return;
    state.tipo = button.dataset.tipo;
    syncPressed(button.parentElement, 'data-tipo', state.tipo);
    renderView();
  });
  document.getElementById('sort-chips').addEventListener('click', (event) => {
    const button = event.target.closest('[data-sort]');
    if (!button) return;
    state.sort = button.dataset.sort;
    syncPressed(button.parentElement, 'data-sort', state.sort);
    renderView();
  });
}

function syncPressed(container, attr, value) {
  container.querySelectorAll('[' + attr + ']').forEach((button) => {
    button.setAttribute('aria-pressed', button.getAttribute(attr) === value ? 'true' : 'false');
  });
}

function resetFilters() {
  state.categoria = 'tutte';
  state.tipo = 'tutte';
  state.sort = 'recenti';
  const slider = document.getElementById('sconto');
  slider.value = '0';
  updateSliderLabel();
  syncPressed(document.getElementById('categoria-chips'), 'data-categoria', 'tutte');
  syncPressed(document.getElementById('tipo-chips'), 'data-tipo', 'tutte');
  syncPressed(document.getElementById('sort-chips'), 'data-sort', 'recenti');
  renderView();
}

function updateSliderLabel() {
  const slider = document.getElementById('sconto');
  const value = Number(slider.value);
  state.scontoMin = value;
  document.getElementById('sconto-label').textContent = value === 0 ? 'Qualsiasi' : value + '%';
  slider.setAttribute('aria-valuenow', String(value));
  slider.setAttribute('aria-valuetext', value === 0 ? 'Qualsiasi sconto' : 'Almeno ' + value + '%');
}

function ensureCategoryChips() {
  const box = document.getElementById('categoria-chips');
  const have = new Set(
    [...box.querySelectorAll('[data-categoria]')].map((button) => button.dataset.categoria)
  );
  for (const offer of state.data.offerte) {
    if (!offer.categoria || have.has(offer.categoria)) continue;
    have.add(offer.categoria);
    const button = el('button', {
      type: 'button',
      class: 'chip',
      'data-categoria': offer.categoria,
      'aria-pressed': 'false',
    }, offer.categoria);
    box.append(button);
  }
}

function tickTimes() {
  if (!state.data) return;
  let boundary = false;
  document.querySelectorAll('time[data-ms]').forEach((node) => {
    const ms = Number(node.dataset.ms);
    node.textContent = tempoFa(ms);
    const card = node.closest('.card');
    if (card && isFresh(ms) !== card.classList.contains('card--fresh')) boundary = true;
  });
  if (boundary) renderView();
  else {
    const visible = viewOffers();
    const fresh = visible.filter((offer) => isFresh(offer.trovataMs)).length;
    document.getElementById('count').textContent = countLabel(visible.length, fresh);
  }
}

// Prima visita: memorizza gli id senza notificare.
// Le visite successive avvisano solo per gli errore_prezzo comparsi dopo.
function watchErrors(offers) {
  const errori = offers.filter((offer) => offer.tipo === 'errore_prezzo' && offer.id);
  const ids = errori.map((offer) => String(offer.id));
  const prev = readSeen();
  writeSeen(ids);
  if (!prev) return;
  const known = new Set(prev);
  const fresh = errori.filter((offer) => !known.has(String(offer.id)));
  if (!fresh.length) return;
  showFreshBanner(fresh);
  notifyFresh(fresh);
}

function readSeen() {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch (err) {
    return null;
  }
}

function writeSeen(ids) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(0, MAX_OFFERS)));
  } catch (err) {
    /* modalità privata: la pagina resta usabile */
  }
}

function showFreshBanner(fresh) {
  const box = document.getElementById('fresh-banner');
  box.hidden = false;
  const text = fresh.length === 1
    ? "C'è un possibile errore di prezzo che non c'era l'ultima volta."
    : 'Ci sono ' + fresh.length + " possibili errori di prezzo che non c'erano l'ultima volta.";
  const button = el('button', { type: 'button', class: 'btn btn-small' }, 'Mostra');
  button.addEventListener('click', () => {
    state.tipo = 'errore_prezzo';
    syncPressed(document.getElementById('tipo-chips'), 'data-tipo', state.tipo);
    renderView();
    const card = document.querySelector('.card--error');
    if (!card) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  });
  box.replaceChildren(el('p', null, text), button);
}

function notifyFresh(fresh) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const body = fresh.length === 1
    ? fresh[0].titolo
    : fresh.length + ' nuove segnalazioni da controllare';
  try {
    new Notification('Possibile errore di prezzo', {
      body: body,
      tag: 'caccia-offerte-errore',
    });
  } catch (err) {
    /* il browser può rifiutare la notifica anche col permesso concesso */
  }
}

function setupNotify() {
  const box = document.getElementById('notify');
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  try {
    if (localStorage.getItem(DISMISS_KEY) === '1') return;
  } catch (err) {
    return;
  }
  box.hidden = false;
  document.getElementById('notify-enable').addEventListener('click', async () => {
    let perm = 'default';
    try {
      perm = await Notification.requestPermission();
    } catch (err) {
      perm = 'default';
    }
    if (perm === 'granted' || perm === 'denied') box.hidden = true;
    if (perm === 'denied') {
      try { localStorage.setItem(DISMISS_KEY, '1'); } catch (err) { /* ignora */ }
    }
  });
  document.getElementById('notify-dismiss').addEventListener('click', () => {
    box.hidden = true;
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (err) { /* ignora */ }
  });
}

function showSoftError() {
  const node = document.getElementById('soft-error');
  node.hidden = false;
  node.textContent = 'Aggiornamento non riuscito. Mostro ancora i dati precedenti.';
}

function clearSoftError() {
  const node = document.getElementById('soft-error');
  node.hidden = true;
  node.textContent = '';
}

function setRefreshing(on) {
  const button = document.getElementById('refresh');
  button.disabled = on;
  button.textContent = on ? 'Aggiorno…' : 'Aggiorna';
  button.setAttribute('aria-busy', on ? 'true' : 'false');
}

function isFresh(ms) {
  if (!Number.isFinite(ms)) return false;
  const delta = Date.now() - ms;
  return delta >= -CLOCK_SKEW_MS && delta <= HOUR_MS;
}

function tempoFa(ms) {
  if (!Number.isFinite(ms)) return 'data sconosciuta';
  const delta = Date.now() - ms;
  if (delta < 60 * 1000) return delta < 0 ? 'adesso' : 'meno di 1 min fa';
  const min = Math.floor(delta / 60000);
  if (min < 60) return min === 1 ? '1 min fa' : min + ' min fa';
  const ore = Math.floor(min / 60);
  if (ore < 24) return ore === 1 ? '1 ora fa' : ore + ' ore fa';
  const giorni = Math.floor(ore / 24);
  if (giorni < 30) return giorni === 1 ? '1 giorno fa' : giorni + ' giorni fa';
  const mesi = Math.floor(giorni / 30);
  return mesi === 1 ? '1 mese fa' : mesi + ' mesi fa';
}

function formatRome(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'non disponibile';
  try {
    return new Intl.DateTimeFormat('it-IT', {
      timeZone: 'Europe/Rome',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch (err) {
    return date.toLocaleString('it-IT');
  }
}

function formatRomeTime(date) {
  try {
    return new Intl.DateTimeFormat('it-IT', {
      timeZone: 'Europe/Rome',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch (err) {
    return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }
}

function formatSconto(n) {
  if (n == null || !Number.isFinite(n)) return '';
  return '−' + Math.round(n) + '%';
}

function shortCategory(name) {
  const known = KNOWN_CATEGORIES.find(([full]) => full === name);
  return known ? known[1] : name;
}

function safeUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.href);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch (err) {
    return '';
  }
  return '';
}

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key.startsWith('data-')) node.dataset[key.slice(5)] = String(value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
