import * as P from './parsers.js';
import { WORKAROUNDS, NO_FEED_LINKS, STATE_CENTRES } from './workarounds.js';

const L = window.L;
const $ = (id) => document.getElementById(id);

// Build DOM without innerHTML: feed text is untrusted and must never be parsed as markup.
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}
const ext = (label, url) => h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, `${label} ↗`);

const store = {
  get(k, d) { try { const v = localStorage.getItem('ep.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ep.' + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};

const CATS = { flights: '✈︎', alerts: '!', internet: '≋', services: '☁︎' };
const POLL_MS = 3 * 60 * 1000;
const STALE_MS = 30 * 60 * 1000;

const state = {
  loc: store.get('loc', null),            // { lat, lon, mode: 'gps'|'manual', label, state }
  radius: store.get('radius', 100),
  notify: store.get('notify', false),
  filters: { flights: true, alerts: true, internet: true, services: true },
  expanded: new Set(),
  showAll: false,
  picking: false,
  lastRefresh: 0,
};
const hadSeen = store.get('seen', null) !== null;
const seen = new Set(store.get('seen', []));

// ---------- fetching ----------

async function request(url, ms = 20000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally { clearTimeout(timer); }
}
const getJson = async (url) => (await request(url)).json();
const getText = async (url) => (await request(url)).text();

let airportsPromise;
const airports = () => (airportsPromise ||= fetch('assets/airports.json').then((r) => r.json()).catch(() => ({})));

// FAA, AWS and Azure do not allow cross-site reads from a browser, so they are read from live/,
// which is filled either by server.js (proxy) or by the scheduled GitHub Pages snapshot.
const LIVE_HINT = 'This feed needs the bundled server (npm start) or the GitHub Pages snapshot job.';
async function liveMeta() {
  try { return Date.parse((await getJson('live/meta.json')).generated) || null; } catch { return null; }
}

const zoneCache = new Map();
async function resolveZones(items) {
  const todo = [];
  const ordered = [...items].sort((a, b) => (b.local - a.local) || (b.sev - a.sev));
  for (const it of ordered) for (const z of it.zones.slice(0, 4)) if (!zoneCache.has(z) && todo.length < 40) todo.push(z);
  const queue = [...new Set(todo)];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let z; (z = queue.shift());) {
      try { zoneCache.set(z, (await getJson(z)).geometry || null); } catch { /* try again next refresh */ }
    }
  }));
  for (const it of items) {
    if (it.geometry || !it.zones.length) continue;
    const geoms = it.zones.slice(0, 4).map((z) => zoneCache.get(z)).filter(Boolean);
    if (!geoms.length) continue;
    it.geometry = { type: 'GeometryCollection', geometries: geoms };
    const c = P.geometryCenter(geoms[0]);
    if (c) [it.lat, it.lon] = c;
  }
}

const NWS = 'https://api.weather.gov';
const COMMS_EVENTS = ['911 Telephone Outage', 'Civil Emergency Message', 'Local Area Emergency', 'Civil Danger Warning', 'Shelter In Place Warning'];
const point = () => `${state.loc.lat.toFixed(2)},${state.loc.lon.toFixed(2)}`;

async function loadNws() {
  const jobs = [
    getJson(`${NWS}/alerts/active?status=actual&severity=Extreme,Severe`).then((j) => P.nwsItems(j)),
    getJson(`${NWS}/alerts/active?status=actual&event=${COMMS_EVENTS.map(encodeURIComponent).join(',')}`).then((j) => P.nwsItems(j)),
  ];
  if (state.loc) jobs.push(getJson(`${NWS}/alerts/active?status=actual&point=${point()}`).then((j) => P.nwsItems(j, { local: true })));
  const results = await Promise.allSettled(jobs);
  if (results[0].status === 'rejected') throw results[0].reason;
  const byId = new Map();
  for (const r of results) for (const it of r.status === 'fulfilled' ? r.value : []) {
    const prev = byId.get(it.id);
    byId.set(it.id, prev ? { ...prev, local: prev.local || it.local } : it);
  }
  const items = [...byId.values()];
  await resolveZones(items);
  return items;
}

const statuspage = (key, label, base, summary) => ({
  key, label, cat: 'services', link: base,
  async load() {
    if (summary) {
      const j = await getJson(`${base}/api/v2/summary.json`);
      return P.statuspageItems(key, label, base, j);
    }
    const [s, i] = await Promise.all([getJson(`${base}/api/v2/status.json`), getJson(`${base}/api/v2/incidents/unresolved.json`)]);
    return P.statuspageItems(key, label, base, { status: s.status, incidents: i.incidents });
  },
});

const FEEDS = [
  { key: 'faa', label: 'FAA airport status', cat: 'flights', link: 'https://nasstatus.faa.gov/', live: true,
    async load(st) {
      const [xml, ap, meta] = await Promise.all([getText('live/faa.xml'), airports(), liveMeta()]);
      if (!xml.includes('<AIRPORT_STATUS_INFORMATION')) throw new Error('unexpected response');
      const parsed = P.parseFaa(xml);
      st.dataTime = parsed.updated || meta;
      return P.faaItems(parsed, ap);
    } },
  { key: 'nws', label: 'National Weather Service and emergency alerts', cat: 'alerts', link: 'https://www.weather.gov/alerts', load: loadNws },
  { key: 'ioda', label: 'Internet connectivity by state (IODA, Georgia Tech)', cat: 'internet', link: 'https://ioda.live/country/US',
    async load() {
      const now = Math.floor(Date.now() / 1000);
      const j = await getJson(`https://api.ioda.inetintel.cc.gatech.edu/v2/outages/alerts?from=${now - 6 * 3600}&until=${now}&entityType=region&relatedTo=country/US`);
      return P.iodaItems(j, STATE_CENTRES);
    } },
  { key: 'aws', label: 'Amazon Web Services', cat: 'services', link: 'https://health.aws.amazon.com/health/status', live: true,
    async load(st) { const [j, meta] = await Promise.all([getJson('live/aws.json'), liveMeta()]); st.dataTime = meta; return P.awsItems(j); } },
  { key: 'azure', label: 'Microsoft Azure', cat: 'services', link: 'https://azure.status.microsoft/', live: true,
    async load(st) {
      const [xml, meta] = await Promise.all([getText('live/azure.xml'), liveMeta()]);
      if (!xml.includes('<rss')) throw new Error('unexpected response');
      st.dataTime = meta; return P.azureItems(xml);
    } },
  { key: 'gcp', label: 'Google Cloud', cat: 'services', link: 'https://status.cloud.google.com/',
    async load() { return P.gcpItems(await getJson('https://status.cloud.google.com/incidents.json')); } },
  statuspage('cloudflare', 'Cloudflare', 'https://www.cloudflarestatus.com', false),
  statuspage('github', 'GitHub', 'https://www.githubstatus.com', true),
  statuspage('openai', 'OpenAI', 'https://status.openai.com', true),
  statuspage('discord', 'Discord', 'https://discordstatus.com', true),
  { key: 'slack', label: 'Slack', cat: 'services', link: 'https://slack-status.com/',
    async load() { return P.slackItems(await getJson('https://slack-status.com/api/v2.0.0/current')); } },
];

// feedState[key] = { ok: true|false|null (null = only cached data), at, error, items, dataTime }
const feedState = {};
{
  const cache = store.get('cache', {});
  for (const f of FEEDS) {
    const c = cache[f.key];
    feedState[f.key] = { ok: null, at: c?.at || 0, error: null, items: c?.items || [], dataTime: c?.dataTime || null };
  }
}

async function runFeed(feed) {
  const st = feedState[feed.key];
  try {
    st.items = await feed.load(st);
    st.ok = true; st.at = Date.now(); st.error = null;
  } catch (e) {
    st.ok = false;
    st.error = !navigator.onLine ? 'No connection.'
      : feed.live ? `Not available here. ${LIVE_HINT}`
      : e?.name === 'AbortError' ? 'Timed out.' : 'Could not be reached.';
  }
  scheduleRender();
}

let refreshing = null;
function refreshAll(only) {
  if (refreshing && !only) return refreshing;
  const feeds = only ? FEEDS.filter((f) => only.includes(f.key)) : FEEDS;
  $('btn-refresh').disabled = true;
  const run = Promise.allSettled(feeds.map(runFeed)).then(() => {
    if (!only) state.lastRefresh = Date.now();
    const cache = {};
    for (const f of FEEDS) {
      const st = feedState[f.key];
      // Shapes can be megabytes; the list and notifications work without them.
      cache[f.key] = { at: st.at, dataTime: st.dataTime, items: st.items.map(({ geometry, zones, ...rest }) => ({ ...rest, zones: [] })) };
    }
    store.set('cache', cache);
    announceNew();
    render();
  }).finally(() => { if (refreshing === run) refreshing = null; $('btn-refresh').disabled = !!refreshing; });
  if (!only) refreshing = run;
  return run;
}

// ---------- items relative to the user ----------

function distance(it) {
  return state.loc && it.lat != null ? P.haversineMi(state.loc.lat, state.loc.lon, it.lat, it.lon) : null;
}
function isNear(it) {
  if (it.national) return true;
  if (!state.loc) return false;
  if (it.local) return true;
  if (it.lat != null) return distance(it) <= state.radius;
  if (state.loc.state && (it.state === state.loc.state || (it.help === 'phone911' && it.states?.includes(state.loc.state)))) return true;
  return false;
}
// Worth interrupting someone for: significant and nearby, an official alert for their exact
// spot, or a critical failure of a nationwide online service.
const isNotable = (it) => (isNear(it) && (it.sev >= 2 || it.local)) || (it.cat === 'services' && it.sev >= 3);

function allItems() {
  return FEEDS.flatMap((f) => feedState[f.key].items.map((it) => ({ ...it, dist: distance(it), near: isNear(it), stale: feedState[f.key].ok !== true })));
}
const bySeverity = (a, b) => (b.sev - a.sev) || ((a.dist ?? 1e9) - (b.dist ?? 1e9)) || a.title.localeCompare(b.title);

// ---------- map ----------

const map = L.map('map', { zoomControl: true, worldCopyJump: true }).setView([39.5, -98.35], 4);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
const layers = Object.fromEntries(Object.keys(CATS).map((c) => [c, L.layerGroup().addTo(map)]));
const meLayer = L.layerGroup().addTo(map);
const markerFor = new Map(); // item id -> marker
const SEV_COLOR = { 3: '#c62828', 2: '#e06c00', 1: '#a07900' };

const legend = L.control({ position: 'bottomleft' });
legend.onAdd = () => h('div', { class: 'legend' },
  ...[[3, 'Major'], [2, 'Moderate'], [1, 'Minor']].flatMap(([s, t]) => [h('i', { style: `background:${SEV_COLOR[s]}` }), t, h('br')]),
  h('i', { style: 'background:#1565c0' }), 'You');
legend.addTo(map);

function popupFor(items) {
  const first = items[0];
  return h('div', { class: 'pop' },
    h('h4', {}, first.area),
    items.map((it) => h('div', { class: 'pop-ev' },
      h('strong', {}, it.title), h('div', {}, it.detail),
      h('div', { class: 'item-meta' }, metaLine(it)))),
    h('div', { class: 'item-links' },
      h('button', { class: 'linkish', type: 'button', onclick: () => showHelp(first.help) }, 'What to do'),
      ext('Official source', first.url)));
}

let mapSignature = '';
function renderMap(items) {
  const sig = items.map((i) => `${i.id}|${i.sev}|${i.lat}|${!!i.geometry}`).join(';') + JSON.stringify([state.filters, state.loc, state.radius]);
  if (sig === mapSignature) return; // keep open popups when nothing changed
  mapSignature = sig;

  markerFor.clear();
  for (const cat of Object.keys(layers)) {
    const group = layers[cat];
    group.clearLayers();
    if (state.filters[cat]) group.addTo(map); else group.remove();
    const mine = items.filter((i) => i.cat === cat);

    for (const it of mine) {
      if (!it.geometry) continue;
      const c = SEV_COLOR[it.sev];
      try {
        L.geoJSON(it.geometry, { style: { color: c, weight: 1.5, fillColor: c, fillOpacity: 0.16 }, interactive: false }).addTo(group);
      } catch { /* malformed shape: the marker below still shows it */ }
    }
    const spots = new Map();
    for (const it of mine) {
      if (it.lat == null) continue;
      const k = `${it.lat.toFixed(3)},${it.lon.toFixed(3)}`;
      if (!spots.has(k)) spots.set(k, []);
      spots.get(k).push(it);
    }
    for (const group2 of spots.values()) {
      group2.sort(bySeverity);
      const top = group2[0];
      const m = L.marker([top.lat, top.lon], {
        icon: L.divIcon({ className: '', html: `<div class="mk sev${top.sev}">${CATS[cat]}</div>`, iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -12] }),
        zIndexOffset: top.sev * 1000, title: top.title, alt: top.title, keyboard: true,
      }).bindPopup(() => popupFor(group2), { maxWidth: 300, maxHeight: 280 });
      m.addTo(group);
      for (const it of group2) markerFor.set(it.id, m);
    }
  }

  meLayer.clearLayers();
  if (state.loc) {
    L.circle([state.loc.lat, state.loc.lon], { radius: state.radius * 1609.34, color: '#1565c0', weight: 1.5, fillOpacity: 0.05, dashArray: '6 5', interactive: false }).addTo(meLayer);
    L.marker([state.loc.lat, state.loc.lon], {
      icon: L.divIcon({ className: '', html: '<div class="mk me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
      zIndexOffset: 5000, title: 'Your location', interactive: false,
    }).addTo(meLayer);
  }
}

function showOnMap(it) {
  selectTab('map');
  const m = markerFor.get(it.id);
  if (!m) return;
  if (!state.filters[it.cat]) toggleFilter(it.cat);
  $('map').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  map.setView(m.getLatLng(), Math.max(map.getZoom(), 7));
  m.openPopup();
}

map.on('click', (e) => {
  if (!state.picking) return;
  setPicking(false);
  setLocation(e.latlng.lat, e.latlng.lng, 'manual');
});

// ---------- list ----------

const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function metaLine(it) {
  return [it.area, it.dist != null && `${Math.round(it.dist)} mi away`, it.updated && `updated ${ago(it.updated)}`,
    it.ends && it.ends > Date.now() && `until ${new Date(it.ends).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`,
    it.stale && 'saved copy'].filter(Boolean).join(' · ');
}

function itemEl(it) {
  const open = state.expanded.has(it.id);
  const w = WORKAROUNDS[it.help];
  return h('article', { class: `item sev${it.sev}` },
    h('button', { class: 'item-head', type: 'button', 'aria-expanded': String(open),
      onclick: () => { open ? state.expanded.delete(it.id) : state.expanded.add(it.id); renderList(allItems()); } },
      h('div', { class: 'item-title' }, h('span', { class: 'badge' }, P.SEV_LABEL[it.sev]), it.title),
      h('div', { class: 'item-meta' }, metaLine(it))),
    open && h('div', { class: 'item-body' },
      it.detail && h('div', {}, it.detail),
      it.instruction && h('div', { class: 'instruction' }, it.instruction),
      w && h('div', { class: 'todo' }, h('strong', {}, 'What to do'),
        h('ol', {}, w.steps.slice(0, 3).map((s) => h('li', {}, s))),
        h('button', { class: 'linkish', type: 'button', onclick: () => showHelp(it.help) }, `All ${w.steps.length} steps`)),
      h('div', { class: 'item-links' },
        it.lat != null && h('button', { class: 'linkish', type: 'button', onclick: () => showOnMap(it) }, 'Show on map'),
        ext('Official source', it.url))));
}

function renderList(items) {
  const shown = items.filter((i) => state.filters[i.cat]);
  const failing = FEEDS.filter((f) => feedState[f.key].ok === false).length;
  const caveat = failing ? ` ${failing} of ${FEEDS.length} sources could not be checked, so this may be incomplete.` : '';
  const out = [];

  const near = shown.filter((i) => i.near).sort(bySeverity);
  if (state.loc) {
    out.push(h('div', { class: 'group-title' }, `Affecting ${state.loc.label} (${state.radius} mi)`));
    if (near.length) out.push(...near.map(itemEl));
    else if (!state.lastRefresh) out.push(h('div', { class: 'empty' }, 'Checking live sources…'));
    else out.push(h('div', { class: `empty ${failing ? '' : 'ok'}` }, `No outages reported within ${state.radius} miles of you.${caveat}`));
  } else {
    out.push(h('div', { class: 'empty' }, 'Set your location above to see what affects you and to get alerts for it.'));
    if (near.length) out.push(...near.map(itemEl)); // nationwide items
  }

  const rest = shown.filter((i) => !i.near).sort(bySeverity);
  out.push(h('div', { class: 'group-title' }, state.loc ? 'Elsewhere and online' : 'Nationwide'));
  if (!rest.length) out.push(h('div', { class: 'empty' }, state.lastRefresh ? `Nothing else reported.${caveat}` : 'Checking live sources…'));
  const limit = state.showAll ? rest.length : 40;
  out.push(...rest.slice(0, limit).map(itemEl));
  if (rest.length > limit) out.push(h('button', { class: 'btn', type: 'button', onclick: () => { state.showAll = true; renderList(allItems()); } }, `Show ${rest.length - limit} more`));

  $('list').replaceChildren(...out);
  for (const cat of Object.keys(CATS)) $(`n-${cat}`).textContent = String(items.filter((i) => i.cat === cat).length);
}

// ---------- banner, sources, help ----------

function renderBanner(items) {
  const b = $('banner');
  const live = FEEDS.some((f) => feedState[f.key].ok === true);
  const tried = FEEDS.some((f) => feedState[f.key].ok !== null);
  const lastSaved = Math.max(...FEEDS.map((f) => feedState[f.key].at));
  let text = '', major = false;
  if (!navigator.onLine || (tried && !live && !refreshing)) {
    text = `No connection to any live source. ${lastSaved ? `Showing data saved at ${clock(lastSaved)}.` : ''} The “What to do” tab works offline.`;
  } else {
    const wide = items.find((i) => i.national && i.sev >= 3);
    const nearMajor = items.filter((i) => i.near && i.sev >= 3 && !i.national);
    if (wide) { text = `${wide.title}. Expect cancellations and long delays nationwide.`; major = true; }
    else if (nearMajor.length) { text = nearMajor.length === 1 ? `Near you: ${nearMajor[0].title}` : `${nearMajor.length} major outages near you`; major = true; }
  }
  b.hidden = !text;
  b.textContent = text;
  b.className = `banner${major ? ' sev3' : ''}`;
}

function renderSources() {
  $('sources').replaceChildren(...FEEDS.map((f) => {
    const st = feedState[f.key];
    const stale = st.ok && st.dataTime && Date.now() - st.dataTime > STALE_MS;
    const status = st.ok === true
      ? `${st.items.length} active item${st.items.length === 1 ? '' : 's'} · checked ${ago(st.at)}` + (st.dataTime ? ` · data from ${ago(st.dataTime)}${stale ? ' (snapshot is old)' : ''}` : '')
      : st.ok === false ? `${st.error}${st.at ? ` Showing a saved copy from ${ago(st.at)}.` : ''}`
      : st.at ? `Saved copy from ${ago(st.at)}; checking…` : 'Checking…';
    return h('div', { class: 'src' },
      h('span', { class: `dot ${st.ok === true ? (stale ? 'stale' : 'ok') : st.ok === false ? 'bad' : ''}` }),
      ext(f.label, f.link), h('span', { class: 'hint' }, st.ok === true ? 'Live' : st.ok === false ? 'Unavailable' : ''),
      h('small', {}, status));
  }));
}

function renderHelp() {
  $('help').replaceChildren(...Object.entries(WORKAROUNDS).map(([key, w]) => h('section', { class: 'card help-card', id: `help-${key}` },
    h('h3', {}, w.title), h('p', { class: 'impact' }, w.impact),
    h('ol', {}, w.steps.map((s) => h('li', {}, s))),
    h('ul', { class: 'links' }, w.links.map((l) => h('li', {}, ext(l.label, l.url)))))));
  $('nofeed').replaceChildren(...NO_FEED_LINKS.map((l) => h('li', {}, ext(l.label, l.url))));
}

function render() {
  const items = allItems();
  renderList(items);
  renderMap(items);
  renderBanner(items);
  renderSources();
  const failing = FEEDS.filter((f) => feedState[f.key].ok === false).length;
  $('updated').textContent = state.lastRefresh
    ? `Updated ${clock(state.lastRefresh)}` + (failing ? ` · ${failing} source${failing === 1 ? '' : 's'} unavailable` : '')
    : 'Loading live data…';
}
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

// ---------- tabs ----------

function selectTab(name) {
  for (const t of document.querySelectorAll('.tabs [role=tab]')) {
    const on = t.dataset.tab === name;
    t.setAttribute('aria-selected', String(on));
    $(`panel-${t.dataset.tab}`).hidden = !on;
  }
  if (name === 'map') map.invalidateSize();
}
function showHelp(key) {
  selectTab('help');
  $(`help-${key}`)?.scrollIntoView({ block: 'start' });
}
for (const t of document.querySelectorAll('.tabs [role=tab]')) t.addEventListener('click', () => selectTab(t.dataset.tab));

function toggleFilter(cat) {
  state.filters[cat] = !state.filters[cat];
  document.querySelector(`.chip[data-cat="${cat}"]`).setAttribute('aria-pressed', String(state.filters[cat]));
  render();
}
for (const c of document.querySelectorAll('.chip')) c.addEventListener('click', () => toggleFilter(c.dataset.cat));

// ---------- location ----------

const locMsg = (t) => { $('loc-msg').textContent = t || ''; };

function renderLocation() {
  $('loc-label').textContent = state.loc ? state.loc.label : 'Not set';
  $('btn-locate').textContent = state.loc?.mode === 'gps' ? 'Update my location' : 'Use my location';
  $('radius').value = String(state.radius);
}

function setLocation(lat, lon, mode, { recenter = true } = {}) {
  const moved = !state.loc || P.haversineMi(state.loc.lat, state.loc.lon, lat, lon) > 1;
  if (!moved) { state.loc.mode = mode; store.set('loc', state.loc); renderLocation(); return; }
  state.loc = { lat, lon, mode, label: `${lat.toFixed(2)}, ${lon.toFixed(2)}`, state: null };
  store.set('loc', state.loc);
  locMsg('');
  renderLocation();
  if (recenter) map.setView([lat, lon], 7);
  render();
  namePlace();
  refreshAll(['nws']); // local alerts depend on the point
}

// Turn coordinates into "City, ST" using the weather service's own lookup (US only).
async function namePlace() {
  const at = state.loc;
  try {
    const rel = (await getJson(`${NWS}/points/${point()}`)).properties.relativeLocation.properties;
    if (state.loc !== at) return;
    state.loc.label = `${rel.city}, ${rel.state}`;
    state.loc.state = rel.state;
    store.set('loc', state.loc);
    renderLocation();
    render();
  } catch { /* outside the US or offline: coordinates remain as the label */ }
}

function locate({ quiet = false } = {}) {
  if (!('geolocation' in navigator) || !window.isSecureContext) {
    if (!quiet) locMsg('Location needs a secure (https) page and a browser that supports it. Use “Pick on map” instead.');
    return;
  }
  if (!quiet) locMsg('Finding your location…');
  navigator.geolocation.getCurrentPosition(
    (pos) => { locMsg(''); setLocation(pos.coords.latitude, pos.coords.longitude, 'gps', { recenter: !quiet || !state.loc }); },
    (err) => {
      if (quiet) return;
      locMsg(err.code === err.PERMISSION_DENIED
        ? 'Location permission is blocked. Allow it for this site in your browser settings, or use “Pick on map”.'
        : 'Could not get a location fix. Try again, or use “Pick on map”.');
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 });
}

function setPicking(on) {
  state.picking = on;
  $('pick-hint').hidden = !on;
  document.body.classList.toggle('picking', on);
  $('btn-pick').textContent = on ? 'Cancel' : 'Pick on map';
  if (on) { selectTab('map'); $('map').scrollIntoView({ block: 'nearest' }); }
}

$('btn-locate').addEventListener('click', () => locate());
$('btn-pick').addEventListener('click', () => setPicking(!state.picking));
$('radius').addEventListener('change', (e) => { state.radius = Number(e.target.value); store.set('radius', state.radius); render(); announceNew(); });
$('btn-refresh').addEventListener('click', () => refreshAll());

// ---------- alerts for new items ----------

function toast(it) {
  const el = h('div', { class: `toast sev${it.sev}`, role: 'alert', onclick: () => { el.remove(); state.expanded.add(it.id); render(); showOnMap(it); } },
    h('b', {}, it.title), h('span', {}, it.area));
  $('toasts').append(el);
  setTimeout(() => el.remove(), 15000);
}

async function systemNotify(title, body, tag) {
  if (!state.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = { body, tag, icon: 'assets/icon-192.png' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.showNotification) await reg.showNotification(title, opts); // required on Android
    else new Notification(title, opts);
  } catch { /* the in-page toast already covers it */ }
}

let firstPass = !hadSeen;
function announceNew() {
  const fresh = allItems().filter((it) => isNotable(it) && !it.stale && !seen.has(it.id)).sort(bySeverity);
  for (const it of fresh) seen.add(it.id);
  if (fresh.length) store.set('seen', [...seen].slice(-800));
  // On the very first visit everything is "new"; the list already shows it, so stay quiet.
  if (firstPass) { firstPass = false; if (!seen.size) store.set('seen', []); return; }
  for (const it of fresh.slice(0, 3)) {
    toast(it);
    systemNotify(it.title, `${it.area}. ${it.detail}`.slice(0, 180), it.id);
  }
  if (fresh.length > 3) systemNotify(`${fresh.length - 3} more outages near you`, 'Open Emergency Prepared to see them.', 'more');
}

function renderNotify() {
  const b = $('btn-notify');
  b.setAttribute('aria-pressed', String(state.notify));
  b.textContent = state.notify ? 'Alerts on' : 'Turn on alerts';
}
$('btn-notify').addEventListener('click', async () => {
  if (state.notify) { state.notify = false; store.set('notify', false); renderNotify(); locMsg('Alerts turned off.'); return; }
  if (!('Notification' in window)) {
    locMsg('This browser cannot show notifications. On iPhone or iPad, add this page to your Home Screen first, then open it from there.');
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { locMsg('Notifications are blocked for this site. Allow them in your browser settings to get alerts.'); return; }
  state.notify = true; store.set('notify', true); renderNotify();
  const n = allItems().filter(isNotable).length;
  const where = state.loc ? state.loc.label : 'nationwide outages (set a location for local alerts)';
  systemNotify('Outage alerts are on', `Watching ${where}. ${n} active now.`, 'welcome');
  locMsg(`You will be alerted about new outages ${state.loc ? `within ${state.radius} miles of ${state.loc.label}` : 'nationwide'} while this app is open or in the background.`);
  if (!state.loc) locate();
});

// ---------- start ----------

renderHelp();
renderLocation();
renderNotify();
if (state.notify && (!('Notification' in window) || Notification.permission !== 'granted')) { state.notify = false; renderNotify(); }
if (state.loc) map.setView([state.loc.lat, state.loc.lon], 7);
render();
refreshAll();

// Ask for the location on the first visit; afterwards only refresh it silently when already allowed.
(async () => {
  let perm = 'prompt';
  try { perm = (await navigator.permissions.query({ name: 'geolocation' })).state; } catch { /* not supported */ }
  if (!state.loc) { if (perm !== 'denied') locate(); else locMsg('Location is blocked for this site. Use “Pick on map”, or allow it in browser settings.'); }
  else if (state.loc.mode === 'gps' && perm === 'granted') locate({ quiet: true });
  if (state.loc && !state.loc.state) namePlace();
})();

setInterval(() => {
  if (document.visibilityState !== 'visible' && !state.notify) return;
  if (state.loc?.mode === 'gps') locate({ quiet: true });
  refreshAll();
}, POLL_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - state.lastRefresh > POLL_MS / 2) refreshAll();
});
window.addEventListener('online', () => refreshAll());
window.addEventListener('offline', () => render());

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
