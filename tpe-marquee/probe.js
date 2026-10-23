// 找出桃園機場「客機抵達」頁面實際使用的資料網址。
// 需在能連上 taoyuan-airport.com 的電腦執行：node probe.js
const PAGE = 'https://www.taoyuan-airport.com/flight_arrival?k=&time=all';
const H = { 'User-Agent': 'Mozilla/5.0' };
const abs = (u, base) => new URL(u, base).href;

(async () => {
  const res = await fetch(PAGE, { headers: H });
  const html = await res.text();
  console.log('page', res.status, html.length, 'bytes');
  for (const k of ['__NEXT_DATA__', '__NUXT__', 'BR810', 'flightNo'])
    if (html.includes(k)) console.log('頁面 HTML 內含:', k);

  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => abs(m[1], PAGE));
  const seen = new Set();
  const scan = (text, from) => {
    for (const m of text.matchAll(/["'`]((?:https?:)?\/\/[^"'`\s]+|\/[A-Za-z0-9_\-\/\.]*(?:api|flight|fids)[A-Za-z0-9_\-\/\.\?=&]*)["'`]/gi)) {
      const u = m[1];
      if (/api|flight|fids|json/i.test(u) && !seen.has(u)) { seen.add(u); console.log('候選:', u, '  <-', from.split('/').pop()); }
    }
  };
  scan(html, 'page');
  for (const s of scripts) {
    try { scan(await (await fetch(s, { headers: H })).text(), s); } catch (e) { console.log('skip', s, e.message); }
  }
  console.log('\n把上面含 api / flight 的網址貼給 Claude 即可。');
})();
