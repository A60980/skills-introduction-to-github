// 桃園機場 T1/T2 客機抵達跑馬燈 — 後端
// 無外部套件，Node 18+。
//   DEMO=1 node server.js                       用示範資料
//   TDX_CLIENT_ID=… TDX_CLIENT_SECRET=… node server.js   用 TDX 即時航班（建議）
//   SOURCE_URL=<資料網址> node server.js         用其他來源（JSON 或 CSV）
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SOURCE_URL = process.env.SOURCE_URL || '';
const TDX_ID = process.env.TDX_CLIENT_ID || '';
const TDX_SECRET = process.env.TDX_CLIENT_SECRET || '';
const TDX = Boolean(TDX_ID && TDX_SECRET);
const TDX_HOST = process.env.TDX_HOST || 'https://tdx.transportdata.tw';
const TDX_TOKEN_URL = process.env.TDX_TOKEN_URL || TDX_HOST + '/auth/realms/TDXConnect/protocol/openid-connect/token';
const AIRPORT = process.env.AIRPORT || 'TPE';
const DEMO = process.env.DEMO === '1' || (!SOURCE_URL && !TDX);
const TIMEOUT_MS = 15000;
const REFRESH_MS = Number(process.env.REFRESH_MS || 60000);

// 各欄位可能的名稱（中/英），依序嘗試；來源欄位不同時改這裡即可
const FIELDS = {
  airline:   ['airlineName', 'airline', '航空公司', '航空公司名稱', 'AirlineName'],
  flight:    ['flightNo', 'flight', 'flightNumber', '航班', '航班編號', 'FlightNumber'],
  terminal:  ['terminal', '航廈', 'Terminal'],
  origin:    ['origin', 'from', '出發地', '起點', '出發地點', 'DepartureAirportName'],
  scheduled: ['scheduledTime', 'scheduled', '表定時間', '表訂時間', '預定時間', 'ScheduleArrivalTime'],
  estimated: ['estimatedTime', 'estimated', '預計時間', '實際時間', 'ActualArrivalTime', 'EstimatedArrivalTime'],
  status:    ['status', 'remark', '狀態', '備註', '航班狀態', 'ArrivalRemark'],
  carousel:  ['carousel', '行李轉盤', '轉盤', 'baggage'],
};
const pick = (o, keys) => { for (const k of keys) if (o[k] != null && o[k] !== '') return String(o[k]).trim(); return ''; };

function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h.trim().replace(/^﻿/, ''), r[i]])));
}

const hhmm = v => (String(v || '').match(/\d{1,2}:\d{2}/) || [''])[0];

function normalize(raw) {
  const t = pick(raw, FIELDS.terminal);
  const terminal = /2/.test(t) ? 'T2' : /1/.test(t) ? 'T1' : '';
  return {
    airline: pick(raw, FIELDS.airline), flight: pick(raw, FIELDS.flight), terminal,
    origin: pick(raw, FIELDS.origin), scheduled: hhmm(pick(raw, FIELDS.scheduled)) || pick(raw, FIELDS.scheduled),
    estimated: hhmm(pick(raw, FIELDS.estimated)) || pick(raw, FIELDS.estimated), status: pick(raw, FIELDS.status),
    carousel: pick(raw, FIELDS.carousel),
  };
}

function demoData() {
  const now = new Date();
  const hm = m => { const d = new Date(now.getTime() + m * 60000); return d.toTimeString().slice(0, 5); };
  const rows = [
    ['長榮航空', 'BR810', 'T2', '香港', -30, 0, '取消'],
    ['中華航空', 'CI906', 'T1', '東京成田', 5, 5, '準時'],
    ['長榮航空', 'BR198', 'T2', '大阪關西', 12, 25, '時間更改'],
    ['華航', 'CI752', 'T1', '新加坡', 20, 20, '準時'],
    ['國泰航空', 'CX464', 'T2', '香港', 35, 35, '準時'],
    ['星宇航空', 'JX801', 'T1', '曼谷', -10, -2, '已到達'],
  ];
  return rows.map(([airline, flight, terminal, origin, s, e, status]) =>
    ({ airline, flight, terminal, origin, scheduled: hm(s), estimated: hm(e), status, carousel: '' }));
}


// ---- TDX（運輸資料流通服務）----
let token = { value: '', exp: 0 };
let names = { airline: null, airport: null, at: 0 };

async function getJSON(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 429) { const e = new Error('TDX 429 rate limited'); e.rateLimited = true; throw e; }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.split('?')[0]}`);
  return res.json();
}

async function tdxToken() {
  if (token.value && Date.now() < token.exp - 60000) return token.value;
  const j = await getJSON(TDX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: TDX_ID, client_secret: TDX_SECRET }),
  });
  token = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return token.value;
}

const tdxGet = async path => getJSON(`${TDX_HOST}/api/basic${path}${path.includes('?') ? '&' : '?'}$format=JSON`,
  { headers: { Authorization: 'Bearer ' + await tdxToken() } });

// 航空公司 / 機場代碼 → 中文名，一天更新一次
async function loadNames() {
  if (names.airline && Date.now() - names.at < 86400000) return;
  const [al, ap] = await Promise.all([tdxGet('/v2/Air/Airline'), tdxGet('/v2/Air/Airport')]);
  names = {
    airline: Object.fromEntries(al.map(a => [a.AirlineID, a.AirlineName?.Zh_tw || a.AirlineName?.En || a.AirlineID])),
    airport: Object.fromEntries(ap.map(a => [a.AirportID, a.AirportName?.Zh_tw || a.AirportName?.En || a.AirportID])),
    at: Date.now(),
  };
}

async function tdxFlights() {
  await loadNames().catch(e => { if (!names.airline) names = { airline: {}, airport: {}, at: 0 }; console.error('names:', e.message); });
  const list = await tdxGet(process.env.TDX_PATH || `/v2/Air/FIDS/Airport/${AIRPORT}`);
  return list
    .filter(f => !f.ArrivalAirportID || f.ArrivalAirportID === AIRPORT) // 只留抵達本機場
    .map(f => {
      const no = String(f.FlightNumber || '');
      return normalize({
        airlineName: names.airline[f.AirlineID] || f.AirlineID,
        flightNo: /^\d/.test(no) ? (f.AirlineID || '') + no : no,
        terminal: f.Terminal,
        origin: names.airport[f.DepartureAirportID] || f.DepartureAirportID,
        scheduledTime: f.ScheduleArrivalTime,
        estimatedTime: f.ActualArrivalTime || f.EstimatedArrivalTime,
        status: f.ArrivalRemark || f.AirRemark || f.Remark,
        carousel: f.BaggageClaim,
      });
    })
    .sort((a, b) => (a.scheduled || '').localeCompare(b.scheduled || ''));
}

let cache = { updatedAt: null, flights: [], error: null };

async function refresh() {
  try {
    let flights;
    if (DEMO) flights = demoData();
    else if (TDX) flights = await tdxFlights();
    else {
      const res = await fetch(SOURCE_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error('upstream HTTP ' + res.status);
      const text = await res.text();
      let list;
      try {
        const j = JSON.parse(text);
        list = Array.isArray(j) ? j : (j.data || j.flights || j.instantSchedule || j.FIDSArrival || Object.values(j).find(Array.isArray) || []);
      } catch { list = parseCSV(text); }
      flights = list.map(normalize);
    }
    cache = { updatedAt: new Date().toISOString(), flights: flights.filter(f => f.flight), error: null };
  } catch (e) {
    cache.error = String(e.message || e); // 失敗時保留舊資料
    if (e.rateLimited) nextDelay = REFRESH_MS * 5; // 被限流就放慢
    console.error('refresh failed:', cache.error);
  }
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/arrivals') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ demo: DEMO, ...cache }));
  }
  const file = path.join(__dirname, 'public', u.pathname === '/' ? 'index.html' : path.normalize(u.pathname).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, () => console.log(`marquee on http://localhost:${PORT}  (${DEMO ? 'DEMO' : TDX ? 'TDX ' + AIRPORT : SOURCE_URL})`));

let nextDelay = REFRESH_MS;
(async function loop() {
  nextDelay = REFRESH_MS;
  await refresh();
  setTimeout(loop, nextDelay);
})();
