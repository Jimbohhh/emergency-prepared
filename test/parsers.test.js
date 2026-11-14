import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../js/parsers.js';

const FAA = `<AIRPORT_STATUS_INFORMATION><Update_Time>Sat Nov 14 09:10:48 2026 GMT</Update_Time>
<Delay_type><Name>Ground Delay Programs</Name><Ground_Delay_List><Ground_Delay><ARPT>SFO</ARPT><Reason>low ceilings</Reason><Avg>1 hour and 12 minutes</Avg><Max>3 hours and 4 minutes</Max></Ground_Delay></Ground_Delay_List></Delay_type>
<Delay_type><Name>Ground Stop Programs</Name><Ground_Stop_List><Program><ARPT>LGA</ARPT><Reason>equipment / outage</Reason><End_Time>5:15 pm EST</End_Time></Program><Program><ARPT>DEN</ARPT><Reason>snow &amp; ice</Reason><End_Time>6:00 pm MST</End_Time></Program></Ground_Stop_List></Delay_type>
<Delay_type><Name>General Arrival/Departure Delay Info</Name><Arrival_Departure_Delay_List><Delay><ARPT>EWR</ARPT><Reason>WX:Thunderstorms</Reason><Arrival_Departure Type="Departure"><Min>1 hour and 16 minutes</Min><Max>1 hour and 30 minutes</Max><Trend>Increasing</Trend></Arrival_Departure></Delay></Arrival_Departure_Delay_List></Delay_type>
<Delay_type><Name>Airport Closures</Name><Airport_Closure_List><Airport><ARPT>SNA</ARPT><Reason>!SNA 11/021 SNA AD AP CLSD 2611140800-2611141415</Reason><Start>Nov 14 at 08:00 UTC.</Start><Reopen>Nov 14 at 14:15 UTC.</Reopen></Airport><Airport><ARPT>LAS</ARPT><Reason>!LAS 10/160 LAS AD AP CLSD TO NON SKED TRANSIENT GA ACFT EXC 24HR PPR</Reason><Start>Oct 28 at 19:26 UTC.</Start><Reopen>Jan 27 at 23:00 UTC.</Reopen></Airport></Airport_Closure_List></Delay_type>
<Delay_type><Name>Airspace Flow Programs</Name><Airspace_Flow_List><Airspace_Flow><CTL_Element>FCAA08</CTL_Element><Reason>WEATHER</Reason><Avg>35 minutes</Avg></Airspace_Flow></Airspace_Flow_List></Delay_type>
</AIRPORT_STATUS_INFORMATION>`;
const AIRPORTS = { DEN: [39.862, -104.673, 'Denver International Airport', 'Denver', 'Colorado'] };

test('FAA: parses every delay type and the feed time', () => {
  const p = P.parseFaa(FAA);
  assert.equal(p.updated, Date.UTC(2026, 10, 14, 9, 10, 48));
  assert.deepEqual(p.events.map((e) => `${e.kind}:${e.airport}`),
    ['ground_delay:SFO', 'ground_stop:LGA', 'ground_stop:DEN', 'delay:EWR', 'closure:SNA', 'closure:LAS', 'flow:null']);
  assert.equal(p.events[2].fields.Reason, 'snow & ice');
  assert.equal(p.events[3].fields.Type, 'Departure');
});

test('FAA: severity, coordinates and partial closures', () => {
  const items = P.faaItems(P.parseFaa(FAA), AIRPORTS);
  const by = Object.fromEntries(items.map((i) => [i.id.split(':').slice(0, 3).join(':'), i]));
  assert.equal(by['faa:stop:DEN'].sev, 3);
  assert.equal(by['faa:stop:DEN'].lat, 39.862);
  assert.match(by['faa:stop:DEN'].detail, /until 6:00 pm MST/);
  assert.equal(by['faa:stop:LGA'].lat, null); // unknown airport still listed
  assert.equal(by['faa:gdp:SFO'].sev, 2);
  assert.equal(by['faa:delay:EWR'].sev, 2); // 90 minutes
  assert.equal(by['faa:closure:SNA'].sev, 2);
  assert.match(by['faa:closure:SNA'].title, /Airport closed/);
  assert.equal(by['faa:closure:LAS'].sev, 1);
  assert.match(by['faa:closure:LAS'].title, /restriction/);
  assert.ok(!items.some((i) => i.national));
});

test('FAA: many ground stops produce one nationwide item', () => {
  const codes = ['ATL', 'ORD', 'DFW', 'DEN', 'LAX', 'JFK', 'SFO', 'SEA', 'MIA'];
  const xml = `<Delay_type><Name>Ground Stop Programs</Name><Ground_Stop_List>${codes.map((c) => `<Program><ARPT>${c}</ARPT><Reason>outage</Reason><End_Time>tbd</End_Time></Program>`).join('')}</Ground_Stop_List></Delay_type>`;
  const items = P.faaItems(P.parseFaa(xml), AIRPORTS);
  assert.equal(items[0].id, 'faa:widespread');
  assert.equal(items[0].national, true);
  assert.match(items[0].title, /9 airports/);
  assert.equal(items.length, 10);
});

test('FAA: empty or garbage input yields nothing', () => {
  assert.deepEqual(P.parseFaa('<html>404</html>').events, []);
  assert.deepEqual(P.faaItems(P.parseFaa(''), {}), []);
});

test('NWS: maps severity, flags 911 outages, skips cancelled and test messages', () => {
  const f = (props, geometry = null) => ({ geometry, properties: { status: 'Actual', messageType: 'Alert', areaDesc: 'Denver', sent: '2026-11-14T02:00:00-07:00', ...props } });
  const items = P.nwsItems({ features: [
    f({ event: 'Blizzard Warning', severity: 'Extreme', geocode: { UGC: ['COZ039', 'COZ040'] }, affectedZones: ['https://api.weather.gov/zones/forecast/COZ039'] }),
    f({ event: '911 Telephone Outage', severity: 'Minor', instruction: 'Call 555-0100.' }, { type: 'Polygon', coordinates: [[[-105, 39], [-104, 39], [-104, 40], [-105, 40], [-105, 39]]] }),
    f({ event: 'Flood Warning', severity: 'Severe', messageType: 'Cancel' }),
    f({ event: 'Tornado Warning', severity: 'Extreme', status: 'Test' }),
  ] }, { local: true });
  assert.equal(items.length, 2);
  assert.equal(items[0].sev, 3);
  assert.deepEqual(items[0].states, ['CO']);
  assert.equal(items[0].zones.length, 1);
  assert.equal(items[1].help, 'phone911');
  assert.equal(items[1].sev, 3);
  assert.deepEqual([items[1].lat, items[1].lon], [39.5, -104.5]);
  assert.equal(items[1].local, true);
});

test('IODA: only recent non-normal signals count, and agreement raises severity', () => {
  const now = 1_800_000_000_000;
  const a = (name, datasource, level, minsAgo) => ({ datasource, level, time: now / 1000 - minsAgo * 60, entity: { name, attrs: { country_code: 'US' } } });
  const items = P.iodaItems({ data: [
    a('Washington', 'merit-nt', 'critical', 30),
    a('Texas', 'bgp', 'critical', 60), a('Texas', 'ping-slash24', 'warning', 20),
    a('Ohio', 'bgp', 'critical', 90), a('Ohio', 'bgp', 'normal', 10), // recovered
    a('Utah', 'bgp', 'critical', 600), // too old
  ] }, { Washington: [47.4, -120.5, 'WA'], Texas: [31.5, -99.3, 'TX'] }, now);
  assert.deepEqual(items.map((i) => [i.area, i.sev, i.state]).sort(), [['Texas', 2, 'TX'], ['Washington', 1, 'WA']]);
});

test('Status pages: open incidents only, with a fallback when the page is degraded', () => {
  const inc = (o) => ({ id: 'a1', name: 'API errors', status: 'investigating', impact: 'major', incident_updates: [{ body: '<p>We are <b>looking</b> into it.</p>' }], ...o });
  const items = P.statuspageItems('gh', 'GitHub', 'https://x', { status: { indicator: 'major' },
    incidents: [inc({}), inc({ id: 'a2', status: 'resolved' }), inc({ id: 'a3', impact: 'maintenance' })] });
  assert.equal(items.length, 1);
  assert.equal(items[0].sev, 2);
  assert.match(items[0].detail, /We are looking into it\./);
  assert.equal(P.statuspageItems('gh', 'GitHub', 'https://x', { status: { indicator: 'none' }, incidents: [] }).length, 0);
  assert.equal(P.statuspageItems('gh', 'GitHub', 'https://x', { status: { indicator: 'critical', description: 'Major outage' }, incidents: [] })[0].sev, 3);
});

test('Cloud providers: ongoing incidents, US regions placed on the map', () => {
  const gcp = P.gcpItems([
    { id: '1', severity: 'high', external_desc: 'Networking down', currently_affected_locations: [{ id: 'us-central1', title: 'Iowa (us-central1)' }] },
    { id: '2', severity: 'low', external_desc: 'Old', end: '2026-01-01T00:00:00Z' },
  ]);
  assert.equal(gcp.length, 1);
  assert.deepEqual([gcp[0].sev, gcp[0].lat], [3, 41.26]);

  const aws = P.awsItems([
    { arn: 'arn:aws:health:us-east-1::event/EC2/X', status: '3', summary: 'Connectivity', service_name: 'EC2', region_name: 'N. Virginia', date: '1794600000', event_log: [{ message: 'first' }, { message: 'latest' }] },
    { arn: 'arn:aws:health:me-central-1::event/Y', status: '3', summary: 'Region', service_name: 'Multiple services', region_name: 'UAE', date: '1' },
  ]);
  assert.deepEqual(aws.map((i) => i.sev), [3, 2]); // overseas regions are capped at moderate
  assert.equal(aws[0].lat, 39.04);
  assert.equal(aws[0].detail, 'latest');
  assert.equal(aws[1].lat, null);

  assert.deepEqual(P.slackItems({ active_incidents: [{ id: 9, title: 'Messages delayed', type: 'outage', services: ['Messaging'] }] }).map((i) => i.sev), [3]);
  const az = P.azureItems('<rss><channel><title>Azure Status</title><item><title>Storage - East US</title><description><![CDATA[<p>Investigating</p>]]></description><link>https://azure.status.microsoft/x</link></item></channel></rss>');
  assert.equal(az.length, 1);
  assert.equal(az[0].detail, 'Investigating');
  assert.deepEqual(P.azureItems('<rss><channel><title>Azure Status</title></channel></rss>'), []);
});

test('helpers', () => {
  assert.ok(Math.abs(P.haversineMi(39.74, -104.99, 40.71, -74.0) - 1627) < 15); // Denver to New York
  assert.equal(P.durationMinutes('3 hours and 4 minutes'), 184);
  assert.equal(P.durationMinutes('45 minutes'), 45);
});
