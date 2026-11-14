// Practical "what to do" guidance for each kind of outage. This content is bundled with the
// app (and cached by the service worker) so it stays readable with no connection at all.

export const WORKAROUNDS = {
  flights: {
    title: 'Flights grounded, stopped or delayed',
    impact: 'A ground stop holds flights bound for an airport at their origin. During a nationwide stop nothing departs; flights already in the air land normally. Delays ripple for a day or more after the stop lifts because crews and aircraft are out of position.',
    steps: [
      'Check your flight in the airline’s app or website before leaving for the airport. The airline’s status is the one that counts for your booking.',
      'If your flight is cancelled, rebook in the app first. At the same time, join the airport line and call the airline. International call-center numbers for the same airline often have shorter waits.',
      'Under US DOT rules you can get a refund to your original payment method if your flight is cancelled or significantly delayed (3+ hours domestic, 6+ hours international) and you choose not to travel. You do not have to accept a voucher.',
      'Look at alternatives early, because they sell out fast: Amtrak, intercity buses, a one-way rental car, or a flight from a nearby airport.',
      'Keep receipts for meals, hotels and transport. Check your credit card’s trip-delay coverage and the airline’s customer-service commitments.',
      'Save your boarding pass, confirmation number and hotel details as screenshots in case apps stop loading.',
      'If you are stuck overnight, ask the airline about hotel and meal vouchers, and keep medication and chargers in your carry-on.',
    ],
    links: [
      { label: 'FAA airport status (official)', url: 'https://nasstatus.faa.gov/' },
      { label: 'US DOT: refunds', url: 'https://www.transportation.gov/airconsumer/refunds' },
      { label: 'US DOT: airline commitments dashboard', url: 'https://www.transportation.gov/airconsumer/airline-customer-service-dashboard' },
    ],
  },
  phone: {
    title: 'Mobile or phone network outage',
    impact: 'Calls, texts and mobile data may fail or show “SOS only”. Two-factor codes sent by text will not arrive, and people may be unable to reach you.',
    steps: [
      'Connect to any Wi-Fi and turn on Wi-Fi Calling in your phone settings. Calls and texts then route over the internet instead of the cell network.',
      'Use internet messaging over Wi-Fi (iMessage, WhatsApp, Signal, email) rather than SMS.',
      'Toggle airplane mode off and on, or restart the phone, once service returns in your area. Avoid repeated redialling, which adds congestion.',
      'For emergencies, call 911 anyway: phones are allowed to use any carrier’s network for 911, even with no plan or “SOS only” showing.',
      'With no signal at all, iPhone 14 or later and some recent Android phones can text emergency services by satellite when you are outdoors with a clear sky.',
      'Agree on a meeting place and an out-of-area contact with your household now, while you can still talk.',
      'Keep texts short and save battery: lower brightness, close apps, and carry a charged power bank.',
    ],
    links: [
      { label: 'AT&T outage check', url: 'https://www.att.com/outages/' },
      { label: 'Verizon network status', url: 'https://www.verizon.com/support/check-network-status/' },
      { label: 'Downdetector (crowd reports)', url: 'https://downdetector.com/' },
    ],
  },
  phone911: {
    title: '911 not working',
    impact: 'Calls to 911 may not connect or may reach the wrong center. Emergency services are still operating; only the way you reach them has changed.',
    steps: [
      'Follow the alert’s instructions first. It normally lists the direct 10-digit number for your local dispatch center.',
      'Try texting 911. Text-to-911 works in many areas; you get an automatic bounce-back message if it is not available where you are.',
      'Call your local police or fire department’s 10-digit number. Look it up now and save it in your contacts.',
      'Try a different kind of phone: a landline, a phone on another carrier, or Wi-Fi calling.',
      'If you cannot get through and it is safe to move, go to the nearest fire station, police station or hospital.',
    ],
    links: [{ label: 'FCC: text-to-911', url: 'https://www.fcc.gov/consumers/guides/what-you-need-know-about-text-911' }],
  },
  internet: {
    title: 'Internet outage',
    impact: 'Home or regional internet may be slow or down. Streaming, smart-home devices, internet phone lines (VoIP) and card payments in shops can all be affected.',
    steps: [
      'Confirm it is not just you: check a second device, then restart the modem and router (unplug for 30 seconds).',
      'Use your phone’s mobile data or personal hotspot if the cell network is up, or the reverse: use Wi-Fi if mobile data is down.',
      'Public Wi-Fi at libraries, community centers and large retailers often runs on a different provider.',
      'Download what you may need while you still have a connection: offline maps of your area, tickets, documents, key phone numbers.',
      'Internet phone lines stop working without internet or power. Keep a charged mobile phone as a backup for 911.',
      'A battery or hand-crank AM/FM or NOAA Weather Radio keeps working when internet and cell service do not.',
    ],
    links: [
      { label: 'IODA internet outage monitor', url: 'https://ioda.live/country/US' },
      { label: 'Downdetector (crowd reports)', url: 'https://downdetector.com/' },
    ],
  },
  services: {
    title: 'Major company, cloud or app outage',
    impact: 'When a large cloud or software provider fails, unrelated things break together: banking and payment apps, card terminals, airline check-in, pharmacies, work tools and websites.',
    steps: [
      'Carry some cash. Card readers, tap-to-pay and ATMs may be offline, sometimes at one bank and not another.',
      'Do not retry a failed payment or transfer over and over; it can post several times once systems recover. Check your balance later.',
      'Use another channel for the same task: the website instead of the app, a phone call, or going in person.',
      'Refill prescriptions and fuel early if the outage is affecting pharmacies or gas stations near you, and call ahead before driving.',
      'Watch for scams. Outages are followed quickly by fake “support” calls, texts and emails. Go to the company’s site yourself rather than clicking links.',
      'For work tools, agree on a fallback with your team (phone tree, a different chat app, email) and keep local copies of what you need today.',
      'Check the provider’s official status page rather than social media for restoration times.',
    ],
    links: [{ label: 'Downdetector (crowd reports)', url: 'https://downdetector.com/' }],
  },
  weather: {
    title: 'Official weather or emergency alert',
    impact: 'An alert from the National Weather Service or local authorities is active for the area shown. Severe weather is also a common cause of flight, power and communications disruption.',
    steps: [
      'Read the alert’s own instructions and follow them. They are written for your specific area and hazard.',
      'Charge phones and power banks now, and keep a flashlight within reach.',
      'Have water, food, medication and warm clothing for at least three days if you may be stuck at home or on the road.',
      'Avoid travel in the affected area if you can. If you must go, tell someone your route and expected arrival.',
      'Keep a battery-powered radio for updates if power or internet fails.',
    ],
    links: [
      { label: 'National Weather Service alerts', url: 'https://www.weather.gov/alerts' },
      { label: 'Ready.gov: make a plan', url: 'https://www.ready.gov/plan' },
    ],
  },
};

// Things people ask about that have no free, public, machine-readable feed.
export const NO_FEED_LINKS = [
  { label: 'Power outages by county (PowerOutage.us)', url: 'https://poweroutage.us/' },
  { label: 'AT&T outage check', url: 'https://www.att.com/outages/' },
  { label: 'Verizon network status', url: 'https://www.verizon.com/support/check-network-status/' },
  { label: 'Crowd-sourced outage reports (Downdetector)', url: 'https://downdetector.com/' },
  { label: 'Microsoft 365 service health', url: 'https://status.cloud.microsoft/' },
  { label: 'FAA National Airspace System status', url: 'https://nasstatus.faa.gov/' },
];

// name: [lat, lon, postal abbreviation]
export const STATE_CENTRES = {
  Alabama: [32.8, -86.8, 'AL'], Alaska: [64.2, -152.5, 'AK'], Arizona: [34.2, -111.7, 'AZ'], Arkansas: [34.9, -92.4, 'AR'],
  California: [37.2, -119.4, 'CA'], Colorado: [39.0, -105.5, 'CO'], Connecticut: [41.6, -72.7, 'CT'], Delaware: [39.0, -75.5, 'DE'],
  'District of Columbia': [38.9, -77.02, 'DC'], Florida: [28.6, -82.4, 'FL'], Georgia: [32.7, -83.4, 'GA'], Hawaii: [20.3, -156.4, 'HI'],
  Idaho: [44.4, -114.6, 'ID'], Illinois: [40.0, -89.2, 'IL'], Indiana: [39.9, -86.3, 'IN'], Iowa: [42.1, -93.5, 'IA'],
  Kansas: [38.5, -98.4, 'KS'], Kentucky: [37.5, -85.3, 'KY'], Louisiana: [31.1, -92.0, 'LA'], Maine: [45.4, -69.2, 'ME'],
  Maryland: [39.0, -76.8, 'MD'], Massachusetts: [42.3, -71.8, 'MA'], Michigan: [44.3, -85.4, 'MI'], Minnesota: [46.3, -94.3, 'MN'],
  Mississippi: [32.7, -89.7, 'MS'], Missouri: [38.4, -92.5, 'MO'], Montana: [47.0, -109.6, 'MT'], Nebraska: [41.5, -99.8, 'NE'],
  Nevada: [39.3, -116.6, 'NV'], 'New Hampshire': [43.7, -71.6, 'NH'], 'New Jersey': [40.2, -74.7, 'NJ'], 'New Mexico': [34.4, -106.1, 'NM'],
  'New York': [42.9, -75.5, 'NY'], 'North Carolina': [35.6, -79.4, 'NC'], 'North Dakota': [47.5, -100.5, 'ND'], Ohio: [40.3, -82.8, 'OH'],
  Oklahoma: [35.6, -97.5, 'OK'], Oregon: [43.9, -120.6, 'OR'], Pennsylvania: [40.9, -77.8, 'PA'], 'Rhode Island': [41.7, -71.5, 'RI'],
  'South Carolina': [33.9, -80.9, 'SC'], 'South Dakota': [44.4, -100.2, 'SD'], Tennessee: [35.9, -86.4, 'TN'], Texas: [31.5, -99.3, 'TX'],
  Utah: [39.3, -111.7, 'UT'], Vermont: [44.1, -72.7, 'VT'], Virginia: [37.5, -78.9, 'VA'], Washington: [47.4, -120.5, 'WA'],
  'West Virginia': [38.6, -80.6, 'WV'], Wisconsin: [44.6, -89.9, 'WI'], Wyoming: [43.0, -107.6, 'WY'], 'Puerto Rico': [18.2, -66.4, 'PR'],
};
