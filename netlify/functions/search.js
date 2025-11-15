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
            const start = Math.max(0, queryIndex - 1000);
            const end = Math.min(transcript.length, queryIndex + 1500);
            excerpt = transcript.substring(start, end);
          } else {
            excerpt = transcript.substring(0, 2500);
          }
          return `SERMON: "${title}"\nPASTOR BOB'S WORDS:\n${excerpt}`;
        }).join('\n\n========\n\n');
        
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
    const timeout = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, 22000);
    const prompt = `You are summarizing Pastor Bob Kopeny's teaching on "${query}".

CRITICAL: You MUST include at least 1-2 EXACT QUOTES from the sermon excerpts below. Copy his actual words verbatim in quotation marks.

Below are Pastor Bob's actual spoken words from his sermons. Write a 4-5 paragraph summary that:

1. Includes 1-2 EXACT QUOTES from Pastor Bob (his actual words from the excerpts)
2. Explains the biblical foundation
3. Shares any stories, illustrations, or examples he uses
4. Shows practical applications

FORMAT FOR QUOTES:
Pastor Bob says, "..." [use his exact words from the excerpts]
Or: As Pastor Bob puts it, "..." [copy directly from the text]

Do NOT paraphrase his quotes - use his EXACT words from the excerpts below.

${excerpts}

Now write the summary with at least 1-2 direct quotes from Pastor Bob's words above:`;
    
    const data = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You include exact quotes from source material. When told to quote, you copy the exact words verbatim in quotation marks.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.6,
      max_tokens: 1300
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
