// Feeds that cannot be read directly by a browser (no CORS headers). server.js proxies them
// on demand; scripts/snapshot.js writes them to live/ for static hosting.
export const LIVE_FEEDS = {
  'faa.xml': { url: 'https://nasstatus.faa.gov/api/airport-status-information', type: 'application/xml; charset=utf-8' },
  'aws.json': { url: 'https://health.aws.amazon.com/public/currentevents', type: 'application/json; charset=utf-8' },
  'azure.xml': { url: 'https://azure.status.microsoft/en-us/status/feed/', type: 'application/xml; charset=utf-8' },
};

function decode(buf) {
  // AWS serves UTF-16 with a byte-order mark; everything else is UTF-8.
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  return new TextDecoder('utf-8').decode(buf);
}

export async function fetchLive(name) {
  const feed = LIVE_FEEDS[name];
  if (!feed) throw new Error(`unknown feed ${name}`);
  const res = await fetch(feed.url, { headers: { 'User-Agent': 'emergency-prepared-outage-map' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return { body: decode(new Uint8Array(await res.arrayBuffer())), type: feed.type };
}
