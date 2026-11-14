# Emergency Prepared

A live outage map with location-based alerts and practical workarounds.

- **Outage map** – flight ground stops, delays and closures (FAA), official weather and emergency alerts including 911 outages (National Weather Service), internet-connectivity drops by state (IODA), and incidents at major online services (AWS, Azure, Google Cloud, Cloudflare, GitHub, OpenAI, Discord, Slack).
- **Your location** – uses the browser's geolocation (or a point you pick on the map) to list what is within 25–250 miles of you first, and to send notifications only for those.
- **What to do** – impact and step-by-step workarounds for each kind of outage. Cached on the device, so it works offline.
- **Sources** – shows which feeds are live, which could not be reached, and links for things with no public feed (mobile carriers, power).

## Run it

```sh
npm start        # no dependencies; needs Node 20+
```

Open <http://localhost:8080>. The server serves the app and proxies three feeds that browsers are not allowed to read directly (FAA, AWS, Azure).

Geolocation and notifications need a secure page: `localhost` counts, a plain `http://` address on your network does not. To use it on a phone, host it over https (below).

## Host it on GitHub Pages

`.github/workflows/pages.yml` publishes the site and re-saves the three proxied feeds into `live/` every 15 minutes.

1. Merge to `main`.
2. Repository **Settings → Pages → Source: GitHub Actions**.

Scheduled runs can lag, so flight data on the hosted site may be 15+ minutes old; the Sources tab shows its age. The schedule uses Actions minutes on a private repository, and GitHub pauses schedules after 60 days without repository activity.

## Limits worth knowing

- Notifications come from the page itself, not a push server. They arrive while the app is open or in a background tab, not after it is closed. On iPhone, add the page to the Home Screen first.
- There is no public feed for mobile-carrier or power outages; the app links to the official pages instead.
- IODA signals are measurements, not confirmed outages. A single signal is shown as minor.
- Location stays on the device. Coordinates rounded to two decimals are sent to weather.gov to look up local alerts.

## Develop

```sh
npm test         # parser tests
npm run snapshot # write live/*.{xml,json} once, for static hosting
```

Feed parsing lives in `js/parsers.js`, guidance text in `js/workarounds.js`, the UI in `js/app.js`. Leaflet 1.9.4 is vendored in `vendor/`; airport coordinates in `assets/airports.json` come from the MIT-licensed `airportsdata` package.
