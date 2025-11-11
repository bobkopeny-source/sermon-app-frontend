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
    const queryLower = query.toLowerCase();
    
    const results = sermons.filter(s => 
      s && (s.title?.toLowerCase().includes(queryLower) || 
            s.transcript?.toLowerCase().replace(/\[\d+:\d+:\d+\]/g, " ").includes(queryLower))
    ).sort((a, b) => {
      const aHas = a.transcript?.match(/\[\d+:\d+:\d+\]/);
      const bHas = b.transcript?.match(/\[\d+:\d+:\d+\]/);
      return (aHas ? -1 : 0) - (bHas ? -1 : 0);
    }).slice(0, 15);
    
    let analysis = `Found ${results.length} sermons.`;
    const KEY = process.env.opeaikey || process.env.OPENAI_API_KEY;
    
    if (KEY && results.length > 0) {
      try {
        const segments = extractSegments(results);
        analysis = segments.length > 5 
          ? await generateWithCitations(segments, query, KEY)
          : await generateSimple(results, query, KEY);
      } catch (e) {
        console.error('AI error:', e.message);
        analysis = `Pastor Bob has ${results.length} sermons on "${query}". See videos below.`;
      }
    }
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grokSynthesis: analysis,
        sermons: results.slice(0, 10).map(s => ({
          id: s.id, title: s.title, url: s.url, word_count: s.word_count,
          youtubeVideo: s.url ? { youtubeUrl: s.url, date: getDate(s.title), scripture: s.title.split('|')[0]?.trim() || '' } : null
        })),
        totalResults: results.length
      })
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

function extractSegments(sermons) {
  const segs = [];
  for (const s of sermons) {
    if (!s.transcript || !s.url) continue;
    const re = /\[(\d+):(\d+):(\d+)\]([\s\S]{300,600}?)(?=\[|$)/g;
    let m, c = 0;
    while ((m = re.exec(s.transcript)) && c < 3) {
      const [_, h, min, sec, txt] = m;
      const ts = `${min}:${sec}`;
      const tot = parseInt(h)*3600 + parseInt(min)*60 + parseInt(sec);
      const dt = getDateLong(s.title);
      if (dt) {
        segs.push({ text: txt.trim(), timestamp: ts, date: dt, url: `${s.url}&t=${tot}s` });
        c++;
      }
    }
    if (segs.length >= 10) break;
  }
  return segs;
}

async function generateWithCitations(segs, query, key) {
  const https = require('https');
  const ctx = segs.map((s,i) => `[${i+1}] At ${s.timestamp} on ${s.date}:\n${s.text}`).join('\n\n');
  const prompt = `Write 3-4 paragraphs about Pastor Bob's teaching on "${query}". After EVERY statement, cite the source like this: ([10:51 from October 09, 2025]). Use actual timestamps below.\n\nSources:\n${ctx}\n\nWrite with frequent citations:`;
  
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, 18000);
    const data = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Always cite with format: ([MM:SS from Month DD, YYYY])' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7, max_tokens: 1000
    });
    const opts = {
      hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        clearTimeout(to);
        if (res.statusCode !== 200) return reject(new Error(`Status ${res.statusCode}`));
        try {
          const r = JSON.parse(body);
          const txt = r.choices?.[0]?.message?.content || '';
          resolve(makeLinks(txt, segs));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', e => { clearTimeout(to); reject(e); });
    req.write(data);
    req.end();
  });
}

async function generateSimple(results, query, key) {
  const https = require('https');
  const ex = results.filter(s => s.transcript).slice(0,2).map(s => s.transcript.substring(0,600)).join('\n\n');
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, 15000);
    const data = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Summarize in 3 paragraphs.' },
        { role: 'user', content: `Summarize Pastor Bob on "${query}":\n\n${ex}` }
      ],
      temperature: 0.7, max_tokens: 500
    });
    const opts = {
      hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        clearTimeout(to);
        try {
          const r = JSON.parse(body);
          resolve(r.choices?.[0]?.message?.content || 'Summary unavailable');
        } catch (e) { reject(e); }
      });
    });
    req.on('error', e => { clearTimeout(to); reject(e); });
    req.write(data);
    req.end();
  });
}

function makeLinks(txt, segs) {
  const re = /\(\[(\d{1,2}:\d{2})\s+from\s+([^\]]+)\]\)/g;
  return txt.replace(re, (match, timestamp, dateStr) => {
    let seg = segs.find(s => s.timestamp === timestamp);
    if (!seg) seg = segs.find(s => s.date && s.date.includes(dateStr.trim()));
    if (!seg && segs.length > 0) seg = segs[0];
    return seg ? `<a href="${seg.url}" target="_blank" class="cite-link" title="Watch at ${timestamp}">([${timestamp} from ${dateStr}])</a>` : match;
  });
}

function getDate(t) {
  const m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : '';
}

function getDateLong(t) {
  const m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return '';
  const d = new Date(m[3], m[1]-1, m[2]);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
