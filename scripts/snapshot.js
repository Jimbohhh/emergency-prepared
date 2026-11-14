#!/usr/bin/env node
// Writes the proxied feeds to <outDir>/live/ so a static host (GitHub Pages) can serve them.
// A feed that fails is skipped, so the app reports it as unavailable instead of showing old data.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LIVE_FEEDS, fetchLive } from './live-feeds.js';

const out = path.join(process.argv[2] || '.', 'live');
await mkdir(out, { recursive: true });
let ok = 0;
for (const name of Object.keys(LIVE_FEEDS)) {
  try {
    await writeFile(path.join(out, name), (await fetchLive(name)).body);
    ok++;
    console.log(`saved ${name}`);
  } catch (e) {
    console.warn(`skipped ${name}: ${e.message}`);
  }
}
await writeFile(path.join(out, 'meta.json'), JSON.stringify({ generated: new Date().toISOString() }));
if (!ok) process.exitCode = 1;
