let sermonsCache = null;

function loadAllSermons() {
  if (sermonsCache) return sermonsCache;
  const part1 = require('../../SERMONS_PART_1.json');
  const part2 = require('../../SERMONS_PART_2.json');
  const part3 = require('../../SERMONS_PART_3.json');
  const part4 = require('../../SERMONS_PART_4.json');
  const part5 = require('../../SERMONS_PART_5.json');
  sermonsCache = [...part1, ...part2, ...part3, ...part4, ...part5];
  console.log(`Loaded ${sermonsCache.length} sermons`);
  return sermonsCache;
}

exports.handler = async (event, context) => {
  try {
    const { query } = JSON.parse(event.body || '{}');
    if (!query) return { statusCode: 400, body: JSON.stringify({ error: 'Query required' }) };
    const sermons = loadAllSermons();
    const results = sermons.filter(s => s && (s.title?.toLowerCase().includes(query.toLowerCase()) || s.transcript?.toLowerCase().replace(/\[\d+:\d+:\d+\]/g, " ").includes(query.toLowerCase()))).sort((a, b) => (a.transcript?.match(/\[\d+:\d+:\d+\]/) ? -1 : 0) - (b.transcript?.match(/\[\d+:\d+:\d+\]/) ? -1 : 0)).slice(0, 15);
    
    let analysis = `Found ${results.length} sermons.`;
    const KEY = process.env.opeaikey || process.env.OPENAI_API_KEY;
    
    if (KEY && results.length > 0) {
      try {
        const segs = getSegments(results);
        if (segs.length >= 3) {
          console.log(`Using ${segs.length} timestamped segments`);
          analysis = await withCites(segs, query, KEY);
        } else {
          console.log('Using simple summary');
          const ex = results.filter(s => s.transcript).slice(0, 3).map(s => s.transcript.substring(0, 800)).join('\n\n');
          analysis = await simple(ex, query, KEY);
        }
      } catch (e) {
        console.error('AI error:', e.message);
        analysis = `Pastor Bob addresses "${query}" in ${results.length} sermons.`;
      }
    }
    
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grokSynthesis: analysis, sermons: results.slice(0, 10).map(s => ({ id: s.id, title: s.title, url: s.url, word_count: s.word_count, youtubeVideo: s.url ? { youtubeUrl: s.url, date: getDate(s.title), scripture: s.title.split('|')[0]?.trim() || s.title.substring(0, 60) } : null })), totalResults: results.length }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

function getSegments(sermons) {
  const segs = [];
  for (const s of sermons) {
    if (!s.transcript || !s.url || !s.transcript.match(/\[\d+:\d+:\d+\]/)) continue;
    const re = /\[(\d+):(\d+):(\d+)\]([\s\S]{200,500}?)(?=\[|$)/g;
    let m, c = 0;
    while ((m = re.exec(s.transcript)) && c < 3) {
      const [_, h, min, sec, txt] = m;
      const ts = `${min}:${sec}`;
      const tot = parseInt(h)*3600 + parseInt(min)*60 + parseInt(sec);
      const dt = getLongDate(s.title);
      if (dt && txt.trim().length > 80) {
        segs.push({ text: txt.trim(), timestamp: ts, date: dt, url: `${s.url}&t=${tot}s` });
        c++;
      }
    }
    if (segs.length >= 8) break;
  }
  return segs;
}

async function withCites(segs, query, key) {
  const https = require('https');
  const srcs = segs.map((s,i) => `[${i+1}] At ${s.timestamp} on ${s.date}, Pastor Bob said:\n"${s.text}"`).join('\n\n---\n\n');
  const prompt = `You are summarizing what Pastor Bob Kopeny ACTUALLY said about "${query}".

Below are EXACT QUOTES from his sermons with timestamps. Write a summary based ONLY on what he actually said in these quotes. Do not add information that isn't in the quotes.

${srcs}

Write 3-4 paragraphs summarizing what Pastor Bob teaches in these actual quotes. After EACH statement, cite which quote it comes from using [1], [2], [3], etc. Only write about content that appears in the quotes above.

Write your summary:`;
  
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, 18000);
    const data = JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: 'Summarize only what is in the provided quotes. Cite each claim with [1], [2], [3].' }, { role: 'user', content: prompt }], temperature: 0.5, max_tokens: 900 });
    const opts = { hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'Content-Length': Buffer.byteLength(data) } };
    const req = https.request(opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        clearTimeout(to);
        if (res.statusCode !== 200) return reject(new Error(`Status ${res.statusCode}`));
        try {
          let txt = JSON.parse(body).choices?.[0]?.message?.content || '';
          segs.forEach((seg, i) => {
            const link = `<a href="${seg.url}" target="_blank" class="cite-link" title="Watch at ${seg.timestamp}">([${seg.timestamp} from ${seg.date}])</a>`;
            txt = txt.replace(new RegExp(`\\[${i+1}\\]`, 'g'), link);
          });
          resolve(txt);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', e => { clearTimeout(to); reject(e); });
    req.write(data);
    req.end();
  });
}

async function simple(ex, query, key) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, 15000);
    const data = JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: 'Summarize in 4 paragraphs.' }, { role: 'user', content: `Summarize Pastor Bob on "${query}":\n\n${ex}` }], temperature: 0.7, max_tokens: 800 });
    const opts = { hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'Content-Length': Buffer.byteLength(data) } };
    const req = https.request(opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { clearTimeout(to); try { resolve(JSON.parse(body).choices?.[0]?.message?.content || 'Summary unavailable'); } catch (e) { reject(e); } });
    });
    req.on('error', e => { clearTimeout(to); reject(e); });
    req.write(data);
    req.end();
  });
}

function getDate(t) {
  const m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : '';
}

function getLongDate(t) {
  const m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return '';
  const d = new Date(m[3], m[1]-1, m[2]);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
