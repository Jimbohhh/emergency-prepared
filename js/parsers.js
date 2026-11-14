// Pure functions that turn each live feed into a common "item" shape.
// No DOM access here so the same code runs in the browser and under `node --test`.
//
// Item shape:
//   { id, cat: 'flights'|'alerts'|'internet'|'services', sev: 1|2|3, title, area, detail,
//     instruction?, lat?, lon?, geometry?, zones?, state?, national?, url, updated?, ends?, help }

export const SEV_LABEL = { 3: 'Major', 2: 'Moderate', 1: 'Minor' };

// ---------- small helpers ----------

export function decodeXml(s) {
  return String(s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .trim();
}

export function stripHtml(s) {
  return String(s ?? '')
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function clip(s, n = 280) {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

export function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function haversineMi(lat1, lon1, lat2, lon2) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Centre of a GeoJSON Polygon / MultiPolygon bounding box, as [lat, lon].
export function geometryCenter(geometry) {
  if (!geometry) return null;
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180, seen = false;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      seen = true;
      if (c[1] < minLat) minLat = c[1];
      if (c[1] > maxLat) maxLat = c[1];
      if (c[0] < minLon) minLon = c[0];
      if (c[0] > maxLon) maxLon = c[0];
    } else c.forEach(walk);
  };
  walk(geometry.type === 'GeometryCollection' ? (geometry.geometries || []).map((g) => g.coordinates || []) : geometry.coordinates || []);
  return seen ? [(minLat + maxLat) / 2, (minLon + maxLon) / 2] : null;
}

// "1 hour and 12 minutes" -> 72
export function durationMinutes(s) {
  if (!s) return 0;
  const h = /(\d+)\s*hour/i.exec(s);
  const m = /(\d+)\s*min/i.exec(s);
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
}

// ---------- FAA airport status (XML) ----------

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

const FAA_KINDS = {
  Ground_Stop_List: 'ground_stop',
  Ground_Delay_List: 'ground_delay',
  Arrival_Departure_Delay_List: 'delay',
  Airport_Closure_List: 'closure',
  Airspace_Flow_List: 'flow',
};

export function parseFaa(xml) {
  const out = { updated: null, events: [] };
  const t = /<Update_Time>\w{3} (\w{3}) +(\d+) (\d+):(\d+):(\d+) (\d{4}) GMT<\/Update_Time>/.exec(xml);
  if (t && t[1] in MONTHS) out.updated = Date.UTC(+t[6], MONTHS[t[1]], +t[2], +t[3], +t[4], +t[5]);

  for (const dt of xml.matchAll(/<Delay_type>([\s\S]*?)<\/Delay_type>/g)) {
    const body = dt[1];
    const typeName = decodeXml((/<Name>([^<]*)<\/Name>/.exec(body) || [])[1]);
    for (const list of body.matchAll(/<(\w+_List)>([\s\S]*?)<\/\1>/g)) {
      const kind = FAA_KINDS[list[1]] || 'other';
      for (const rec of list[2].matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)) {
        const fields = {};
        for (const f of rec[2].matchAll(/<(\w+)(?:\s[^>]*)?>([^<]*)<\/\1>/g)) fields[f[1]] = decodeXml(f[2]);
        const type = /<Arrival_Departure\s+Type="([^"]*)"/.exec(rec[2]);
        if (type) fields.Type = decodeXml(type[1]);
        out.events.push({ kind, typeName, airport: fields.ARPT || null, fields });
      }
    }
  }
  return out;
}

// airports: { DEN: [lat, lon, name, city, state], ... }
export function faaItems(parsed, airports = {}) {
  const items = [];
  const stopped = new Set();
  for (const ev of parsed.events) {
    const f = ev.fields;
    const code = ev.airport;
    const ap = code ? airports[code] : null;
    const reason = f.Reason || '';
    const base = {
      cat: 'flights', help: 'flights', url: 'https://nasstatus.faa.gov/',
      updated: parsed.updated, airport: code,
      area: ap ? `${ap[2]} — ${ap[3]}, ${ap[4]}` : code || 'National airspace',
      lat: ap ? ap[0] : null, lon: ap ? ap[1] : null,
    };
    if (ev.kind === 'ground_stop') {
      stopped.add(code);
      items.push({ ...base, id: `faa:stop:${code}`, sev: 3, title: `Ground stop — ${code}`,
        detail: clip(`Departures to ${code} are being held at their origin airports.` +
          (reason ? ` Reason: ${reason}.` : '') + (f.End_Time ? ` Expected until ${f.End_Time}.` : '')) });
    } else if (ev.kind === 'ground_delay') {
      items.push({ ...base, id: `faa:gdp:${code}`, sev: 2, title: `Ground delay program — ${code}`,
        detail: clip(`Flights to ${code} are being delayed at origin` +
          (f.Avg ? `, averaging ${f.Avg}` : '') + (f.Max ? ` (up to ${f.Max})` : '') + '.' +
          (reason ? ` Reason: ${reason}.` : '')) });
    } else if (ev.kind === 'delay') {
      const type = f.Type || 'Arrival/departure';
      const max = durationMinutes(f.Max);
      items.push({ ...base, id: `faa:delay:${code}:${type}`, sev: max >= 60 ? 2 : 1, title: `${type} delays — ${code}`,
        detail: clip([f.Min && f.Max ? `${f.Min} to ${f.Max}` : f.Max || f.Min, f.Trend && `trend: ${f.Trend.toLowerCase()}`,
          reason && `reason: ${reason}`].filter(Boolean).join('; ') + '.') });
    } else if (ev.kind === 'closure') {
      // NOTAM text such as "AP CLSD TO NON SKED TRANSIENT GA ACFT" or "AP CLSD EXC HEL OPS" is a
      // partial restriction, not a closure that stops airline flights.
      const partial = /CLSD\s+(TO|EXC)\b/i.test(reason);
      items.push({ ...base, id: `faa:closure:${code}:${hash(reason)}`, sev: partial ? 1 : 2,
        title: `${partial ? 'Airport restriction' : 'Airport closed'} — ${code}`,
        detail: clip([partial ? 'Closed to some traffic only; airline flights are usually unaffected.' : 'Closed to all traffic for the period below.',
          f.Start && `From ${f.Start}`, f.Reopen && `Reopens ${f.Reopen}`, reason && `NOTAM: ${reason}`].filter(Boolean).join(' '), 360) });
    } else if (ev.kind === 'flow') {
      const el = f.CTL_Element || 'airspace';
      items.push({ ...base, id: `faa:flow:${el}`, sev: 1, lat: null, lon: null, area: 'En-route airspace',
        title: `Airspace flow program — ${el}`,
        detail: clip(`Flights routed through this airspace are being metered` + (f.Avg ? `, averaging ${f.Avg}` : '') + '.' +
          (reason ? ` Reason: ${reason}.` : '')) });
    }
  }
  if (stopped.size >= WIDESPREAD_GROUND_STOPS) {
    items.unshift({ id: 'faa:widespread', cat: 'flights', help: 'flights', sev: 3, national: true,
      url: 'https://nasstatus.faa.gov/', updated: parsed.updated, lat: null, lon: null, area: 'Nationwide',
      title: `Widespread ground stops — ${stopped.size} airports`,
      detail: `Ground stops are in effect at ${stopped.size} airports (${[...stopped].sort().slice(0, 12).join(', ')}${stopped.size > 12 ? '…' : ''}). Expect cancellations and long delays across the country.` });
  }
  return items;
}
export const WIDESPREAD_GROUND_STOPS = 8;

// ---------- NWS / IPAWS alerts (GeoJSON) ----------

const COMMS_EVENT = /911|telephone outage/i;
const NWS_SEV = { Extreme: 3, Severe: 2 };

export function nwsItems(geojson, { local = false } = {}) {
  const items = [];
  for (const feat of geojson?.features || []) {
    const p = feat.properties || {};
    if (!p.event || p.status !== 'Actual' || p.messageType === 'Cancel') continue;
    const comms = COMMS_EVENT.test(p.event);
    const centre = geometryCenter(feat.geometry);
    const ugc = p.geocode?.UGC || [];
    items.push({
      id: `nws:${p.event}:${hash(p.areaDesc || '')}`,
      cat: 'alerts', help: comms ? 'phone911' : 'weather',
      sev: comms ? 3 : NWS_SEV[p.severity] || 1,
      title: p.event, area: clip(p.areaDesc || '', 160),
      detail: clip(p.headline || p.description || '', 320),
      instruction: p.instruction ? clip(p.instruction, 420) : null,
      geometry: feat.geometry || null,
      zones: feat.geometry ? [] : (p.affectedZones || []),
      lat: centre ? centre[0] : null, lon: centre ? centre[1] : null,
      states: [...new Set(ugc.map((u) => u.slice(0, 2)))],
      local, url: 'https://www.weather.gov/alerts',
      updated: Date.parse(p.sent) || null, ends: Date.parse(p.ends || p.expires) || null,
    });
  }
  return items;
}

// ---------- IODA internet-connectivity signals ----------

const IODA_SOURCES = { bgp: 'BGP routing', 'ping-slash24': 'active probing', 'merit-nt': 'network telescope',
  'ucsd-nt': 'network telescope', gtr: 'Google traffic', 'gtr-norm': 'Google traffic' };
export const IODA_WINDOW_MS = 3 * 3600 * 1000;

// stateCentres: { 'Washington': [lat, lon, 'WA'], ... }
export function iodaItems(json, stateCentres, now = Date.now()) {
  const latest = new Map(); // "state|datasource" -> alert
  for (const a of json?.data || []) {
    const name = a.entity?.name;
    if (!name || a.entity?.attrs?.country_code !== 'US') continue;
    const k = `${name}|${a.datasource}`;
    if (!latest.has(k) || latest.get(k).time < a.time) latest.set(k, a);
  }
  const byState = new Map();
  for (const a of latest.values()) {
    if (a.level === 'normal' || now - a.time * 1000 > IODA_WINDOW_MS) continue;
    const name = a.entity.name;
    if (!byState.has(name)) byState.set(name, []);
    byState.get(name).push(a);
  }
  const items = [];
  for (const [name, alerts] of byState) {
    const c = stateCentres[name];
    const sources = [...new Set(alerts.map((a) => IODA_SOURCES[a.datasource] || a.datasource))];
    const when = Math.max(...alerts.map((a) => a.time)) * 1000;
    items.push({
      id: `ioda:${name}`, cat: 'internet', help: 'internet', sev: Math.min(3, sources.length),
      title: `Possible internet disruption — ${name}`, area: name, state: c ? c[2] : null,
      detail: `Connectivity measurements dropped below normal (${sources.join(', ')}). ` +
        (sources.length === 1 ? 'A single signal is often noise; treat this as a hint, not confirmation.' : 'Several independent signals agree, which makes a real disruption more likely.'),
      lat: c ? c[0] : null, lon: c ? c[1] : null,
      url: 'https://ioda.live/country/US', updated: when,
    });
  }
  return items;
}

// ---------- Service status pages ----------

// Rough data-centre locations for US cloud regions, so regional cloud incidents can be drawn on the map.
export const CLOUD_REGIONS = {
  'us-east-1': [39.04, -77.49, 'N. Virginia'], 'us-east-2': [40.0, -83.0, 'Ohio'],
  'us-west-1': [37.35, -121.96, 'N. California'], 'us-west-2': [45.84, -119.7, 'Oregon'],
  'us-central1': [41.26, -95.86, 'Iowa'], 'us-east1': [33.2, -80.0, 'South Carolina'],
  'us-east4': [39.03, -77.47, 'N. Virginia'], 'us-east5': [39.96, -82.99, 'Columbus'],
  'us-south1': [32.78, -96.8, 'Dallas'], 'us-west1': [45.6, -121.18, 'Oregon'],
  'us-west2': [34.05, -118.24, 'Los Angeles'], 'us-west3': [40.76, -111.89, 'Salt Lake City'],
  'us-west4': [36.17, -115.14, 'Las Vegas'],
};

const svc = (key, o) => ({ cat: 'services', help: 'services', lat: null, lon: null, area: 'Online service', service: key, ...o });
const IMPACT_SEV = { critical: 3, major: 2, minor: 1, none: 1 };

// Statuspage-compatible JSON (GitHub, Cloudflare, Discord, OpenAI ...).
export function statuspageItems(key, name, pageUrl, { status, incidents = [] } = {}) {
  const items = [];
  for (const inc of incidents) {
    if (inc.impact === 'maintenance' || ['resolved', 'postmortem', 'completed', 'scheduled'].includes(inc.status)) continue;
    const upd = (inc.incident_updates || [])[0];
    items.push(svc(key, {
      id: `svc:${key}:${inc.id}`, sev: IMPACT_SEV[inc.impact] || 1, title: `${name}: ${clip(inc.name, 110)}`,
      detail: clip([inc.status && `Status: ${inc.status}.`, upd && stripHtml(upd.body)].filter(Boolean).join(' ')),
      url: inc.shortlink || pageUrl, updated: Date.parse(inc.updated_at || inc.created_at) || null,
    }));
  }
  const ind = status?.indicator;
  if (!items.length && ind && ind !== 'none' && ind !== 'maintenance') {
    items.push(svc(key, { id: `svc:${key}:status:${ind}`, sev: IMPACT_SEV[ind] || 1, title: `${name}: ${status.description || 'Degraded'}`,
      detail: 'The status page reports a problem but lists no open incident yet.', url: pageUrl, updated: null }));
  }
  return items;
}

export function slackItems(json) {
  const sev = { outage: 3, incident: 2, notice: 1 };
  return (json?.active_incidents || []).map((inc) => svc('slack', {
    id: `svc:slack:${inc.id}`, sev: sev[inc.type] || 1, title: `Slack: ${clip(inc.title, 110)}`,
    detail: clip([(inc.services || []).length && `Affects ${inc.services.join(', ')}.`, stripHtml((inc.notes || [])[0]?.body)].filter(Boolean).join(' ')),
    url: inc.url || 'https://slack-status.com/', updated: Date.parse(inc.date_updated) || null,
  }));
}

function regionPlace(ids, names) {
  const hit = ids.map((id) => CLOUD_REGIONS[id]).find(Boolean);
  const shown = names.slice(0, 4).join(', ') + (names.length > 4 ? ` +${names.length - 4} more` : '');
  return { lat: hit ? hit[0] : null, lon: hit ? hit[1] : null, area: shown || 'Global / unspecified regions' };
}

export function gcpItems(list) {
  const sev = { high: 3, medium: 2, low: 1 };
  return (Array.isArray(list) ? list : []).filter((i) => !i.end).map((i) => {
    const locs = i.currently_affected_locations || [];
    return svc('gcp', {
      id: `svc:gcp:${i.id}`, sev: sev[i.severity] || 1, title: `Google Cloud: ${clip(i.external_desc, 110)}`,
      ...regionPlace(locs.map((l) => l.id), locs.map((l) => l.title)),
      detail: clip([i.service_name && `Service: ${i.service_name}.`, stripHtml(i.most_recent_update?.text)].filter(Boolean).join(' ')),
      url: i.uri ? `https://status.cloud.google.com/${i.uri}` : 'https://status.cloud.google.com/',
      updated: Date.parse(i.modified || i.begin) || null,
    });
  });
}

export function awsItems(list) {
  return (Array.isArray(list) ? list : []).map((e) => {
    const region = String(e.arn || '').split(':')[3] || '';
    const inUs = region.startsWith('us-') || region === 'global' || region === '';
    const status = Number(e.status) || 1; // 1 informational, 2 degraded, 3 disrupted
    const log = e.event_log || [];
    return svc('aws', {
      id: `svc:aws:${hash(e.arn || e.summary || '')}`,
      sev: inUs ? Math.min(3, status) : Math.min(2, status),
      title: `AWS: ${clip(e.summary || 'Service event', 80)} — ${e.service_name || 'service'}`,
      ...regionPlace([region], [e.region_name ? `${e.region_name} (${region})` : region || 'Global']),
      detail: clip(stripHtml(log[log.length - 1]?.message || log[0]?.message || '')),
      url: 'https://health.aws.amazon.com/health/status', updated: Number(e.date) * 1000 || null,
    });
  });
}

export function azureItems(xml) {
  const items = [];
  for (const m of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const get = (tag) => decodeXml((new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(m[1]) || [])[1]);
    const title = get('title');
    if (!title) continue;
    items.push(svc('azure', {
      id: `svc:azure:${hash(get('guid') || title)}`, sev: 2, title: `Microsoft Azure: ${clip(title, 110)}`,
      detail: clip(stripHtml(get('description'))), url: get('link') || 'https://azure.status.microsoft/',
      updated: Date.parse(get('pubDate')) || null,
    }));
  }
  return items;
}
