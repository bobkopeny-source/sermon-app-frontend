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
    
    const scoredResults = sermons.filter(s => s && s.transcript).map(s => {
      const titleLower = (s.title || '').toLowerCase();
      const transcriptLower = s.transcript.toLowerCase().replace(/\[\d+:\d+:\d+\]/g, ' ');
      const titleMatches = (titleLower.match(new RegExp(queryLower, 'g')) || []).length;
      const transcriptMatches = (transcriptLower.match(new RegExp(queryLower, 'g')) || []).length;
      const score = (titleMatches * 10) + transcriptMatches;
      return { sermon: s, score: score, transcriptMatches: transcriptMatches };
    }).filter(r => r.score > 0).sort((a, b) => b.score - a.score);
    
    const topForSummary = scoredResults.slice(0, 5);
    
    let analysis = `Found ${scoredResults.length} sermons addressing "${query}".`;
    const KEY = process.env.opeaikey || process.env.OPENAI_API_KEY;
    
    if (KEY && topForSummary.length > 0) {
      try {
        const relevantExcerpts = topForSummary.map(r => {
          const s = r.sermon;
          const transcript = s.transcript.replace(/\[\d+:\d+:\d+\]/g, ' ');
          const title = s.title || 'Untitled';
          const lowerTranscript = transcript.toLowerCase();
          const queryIndex = lowerTranscript.indexOf(queryLower);
          let excerpt;
          if (queryIndex !== -1) {
            const start = Math.max(0, queryIndex - 500);
            const end = Math.min(transcript.length, queryIndex + 1000);
            excerpt = transcript.substring(start, end);
          } else {
            excerpt = transcript.substring(0, 1500);
          }
          return `From "${title}":\n${excerpt}`;
        }).join('\n\n---\n\n');
        
        console.log(`Generating summary from ${topForSummary.length} sermons`);
        analysis = await callOpenAI(relevantExcerpts, query, KEY);
      } catch (e) {
        console.error('OpenAI error:', e.message);
        analysis = `Pastor Bob addresses "${query}" in ${scoredResults.length} sermons. His teaching emphasizes biblical truth and practical application for daily Christian living.`;
      }
    }
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grokSynthesis: analysis,
        sermons: [],
        totalResults: scoredResults.length
      })
    };
  } catch (error) {
    console.error('Handler error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

async function callOpenAI(excerpts, query, key) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, 20000);
    const prompt = `You are summarizing Pastor Bob Kopeny's biblical teaching on "${query}" from Calvary Chapel East Anaheim.

Below are excerpts from his sermons where he discusses this topic. Write a comprehensive 4-5 paragraph summary of his teaching.

Focus on:
- The biblical foundations and scriptures he emphasizes
- Practical applications for Christian living
- Key theological points he makes
- How this topic connects to the broader gospel message

SERMON EXCERPTS:
${excerpts}

Write a clear, comprehensive summary of Pastor Bob's teaching on "${query}":`;
    
    const data = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a theological writer summarizing pastoral teaching accurately and comprehensively.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1000
    });
    const opts = { hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'Content-Length': Buffer.byteLength(data) } };
    const req = https.request(opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        clearTimeout(timeout);
        if (res.statusCode !== 200) return reject(new Error(`Status ${res.statusCode}`));
        try {
          const content = JSON.parse(body).choices?.[0]?.message?.content;
          if (content) resolve(content); else reject(new Error('No content'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', e => { clearTimeout(timeout); reject(e); });
    req.write(data);
    req.end();
  });
}
