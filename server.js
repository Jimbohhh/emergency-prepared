#!/usr/bin/env node
// Local server: serves the app and proxies the feeds a browser cannot read directly.
// No dependencies. Usage: npm start   (then open http://localhost:8080)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIVE_FEEDS, fetchLive } from './scripts/live-feeds.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const PUBLIC = ['index.html', 'sw.js', 'manifest.webmanifest', 'css', 'js', 'vendor', 'assets'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const CACHE_MS = 60 * 1000; // be polite to upstream when several tabs are open
const cache = new Map();

async function live(name) {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const fresh = { ...(await fetchLive(name)), at: Date.now() };
  cache.set(name, fresh);
  return fresh;
}

http.createServer(async (req, res) => {
  const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'text/plain', 'Method not allowed');
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';

    if (rel.startsWith('live/')) {
      const name = rel.slice(5);
      if (name === 'meta.json') return send(200, TYPES['.json'], JSON.stringify({ generated: new Date().toISOString() }));
      if (!(name in LIVE_FEEDS)) return send(404, 'text/plain', 'Not found');
      try { const f = await live(name); return send(200, f.type, f.body); }
      catch (e) { console.warn(e.message); return send(502, 'text/plain', 'Upstream feed unavailable'); }
    }

    const file = path.resolve(ROOT, rel);
    const top = path.relative(ROOT, file).split(path.sep)[0];
    if (!PUBLIC.includes(top)) return send(404, 'text/plain', 'Not found');
    send(200, TYPES[path.extname(file)] || 'application/octet-stream', await readFile(file));
  } catch {
    send(404, 'text/plain', 'Not found');
  }
}).listen(PORT, () => console.log(`Emergency Prepared running at http://localhost:${PORT}`));
