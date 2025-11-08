exports.handler = async (event, context) => {
  try {
    const { query } = JSON.parse(event.body || '{}');
    if (!query) return { statusCode: 400, body: JSON.stringify({ error: 'Query required' }) };
    
    const sermons = require('../../PASTOR_BOB_COMPLETE_2072.json');
    const results = sermons.filter(s => 
      s && (s.title?.toLowerCase().includes(query.toLowerCase()) || 
            s.transcript?.toLowerCase().includes(query.toLowerCase()))
    ).slice(0, 10);
    
    let grokAnalysis = 'Analyzing...';
    const GROK_API_KEY = process.env.GROK_API_KEY;
    
    if (GROK_API_KEY && results.length > 0) {
      try {
        const chunks = extractChunks(results);
        grokAnalysis = await callGrokForceCitations(chunks, query, GROK_API_KEY);
      } catch (error) {
        console.error('Grok error:', error);
        grokAnalysis = 'AI synthesis unavailable.';
      }
    }
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grokSynthesis: grokAnalysis,
        sermons: results.map(s => ({
          id: s.id, title: s.title, url: s.url, word_count: s.word_count,
          youtubeVideo: s.url ? { youtubeUrl: s.url, date: extractDate(s.title), scripture: s.title.split('|')[0]?.trim() || '' } : null
        })),
        totalResults: results.length
      })
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

function extractChunks(sermons) {
  const chunks = [];
  sermons.forEach(s => {
    if (!s.transcript || !s.url) return;
    const regex = /\[(\d+):(\d+):(\d+)\]([\s\S]{1,400}?)(?=\[|$)/g;
    let match, count = 0;
    while ((match = regex.exec(s.transcript)) && count < 3) {
      const [_, h, m, sec, text] = match;
      const totalSec = parseInt(h)*3600 + parseInt(m)*60 + parseInt(sec);
      chunks.push({
        text: text.trim(),
        time: `${h}:${m}:${sec}`,
        url: `${s.url}&t=${totalSec}s`,
        ref: s.title.split('|')[0]?.trim() || s.title.substring(0, 30)
      });
      count++;
    }
  });
  return chunks.slice(0, 6);
}

async function callGrokForceCitations(chunks, query, apiKey) {
  const https = require('https');
  
  const numbered = chunks.map((c,i) => `SOURCE ${i+1}:\nFrom: ${c.ref} at ${c.time}\n${c.text}`).join('\n\n');
  
  const prompt = `Write 3 paragraphs about Pastor Bob's teaching on "${query}".

MANDATORY: You MUST cite sources using this EXACT format after EVERY claim:
- "Pastor Bob teaches X [SOURCE 1]"
- "He explains Y [SOURCE 2]"

DO NOT write without citations. EVERY sentence needs [SOURCE #].

SOURCES:
${numbered}

Write 3 paragraphs with [SOURCE #] after EVERY claim:`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, 15000);
    const data = JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      model: 'grok-3',
      temperature: 0.5,
      max_tokens: 1000
    });
    const options = {
      hostname: 'api.x.ai', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(body);
          if (response.choices?.[0]?.message?.content) {
            let text = response.choices[0].message.content;
            chunks.forEach((c, i) => {
              const pattern = new RegExp(`\\[SOURCE ${i+1}\\]`, 'g');
              const link = `<a href="${c.url}" target="_blank" class="timestamp-link" title="${c.ref} at ${c.time}">🎥</a>`;
              text = text.replace(pattern, link);
            });
            resolve(text);
          } else { reject(new Error('No content')); }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', e => { clearTimeout(timeout); reject(e); });
    req.write(data);
    req.end();
  });
}

function extractDate(title) {
  const m = title.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : '';
}