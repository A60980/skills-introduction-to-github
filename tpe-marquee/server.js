// 桃園機場 T1/T2 客機抵達跑馬燈 — 後端
// 無外部套件，Node 18+。
//   DEMO=1 node server.js                       用示範資料
//   SOURCE_URL=<資料網址> node server.js         用真實資料（JSON 或 CSV）
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SOURCE_URL = process.env.SOURCE_URL || '';
const DEMO = process.env.DEMO === '1' || !SOURCE_URL;
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

function normalize(raw) {
  const t = pick(raw, FIELDS.terminal);
  const terminal = /2/.test(t) ? 'T2' : /1/.test(t) ? 'T1' : '';
  return {
    airline: pick(raw, FIELDS.airline), flight: pick(raw, FIELDS.flight), terminal,
    origin: pick(raw, FIELDS.origin), scheduled: pick(raw, FIELDS.scheduled),
    estimated: pick(raw, FIELDS.estimated), status: pick(raw, FIELDS.status),
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

let cache = { updatedAt: null, flights: [], error: null };

async function refresh() {
  try {
    let flights;
    if (DEMO) flights = demoData();
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
}).listen(PORT, () => console.log(`marquee on http://localhost:${PORT}  (${DEMO ? 'DEMO' : SOURCE_URL})`));

refresh();
setInterval(refresh, REFRESH_MS);
