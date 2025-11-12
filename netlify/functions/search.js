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
    const results = sermons.filter(s => s && (s.title?.toLowerCase().includes(query.toLowerCase()) || s.transcript?.toLowerCase().replace(/\[\d+:\d+:\d+\]/g, " ").includes(query.toLowerCase()))).slice(0, 15);
    let analysis = `Found ${results.length} sermons.`;
    const KEY = process.env.opeaikey || process.env.OPENAI_API_KEY;
    if (KEY && results.length > 0) {
      try {
        const excerpts = results.filter(s => s.transcript).slice(0, 3).map(s => s.transcript.substring(0, 800)).join('\n\n');
        analysis = await callAI(excerpts, query, KEY);
      } catch (e) {
        analysis = `Pastor Bob addresses "${query}" in ${results.length} sermons.`;
      }
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grokSynthesis: analysis,
        sermons: results.slice(0, 10).map(s => ({
          id: s.id, title: s.title, url: s.url, word_count: s.word_count,
          youtubeVideo: s.url ? { youtubeUrl: s.url, date: getDate(s.title), scripture: s.title.split('|')[0]?.trim() || s.title.substring(0, 60) } : null
        })),
        totalResults: results.length
      })
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

async function callAI(excerpts, query, key) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, 15000);
    const data = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: 'Summarize in 4 paragraphs.' }, { role: 'user', content: `Summarize Pastor Bob on "${query}":\n\n${excerpts}` }],
      temperature: 0.7, max_tokens: 800
    });
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
