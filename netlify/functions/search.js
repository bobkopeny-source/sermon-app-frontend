let sermonsCache = null;

function loadAllSermons() {
  if (sermonsCache) return sermonsCache;
  
  const part1 = require('../../SERMONS_PART_1.json');
  const part2 = require('../../SERMONS_PART_2.json');
  const part3 = require('../../SERMONS_PART_3.json');
  const part4 = require('../../SERMONS_PART_4.json');
  const part5 = require('../../SERMONS_PART_5.json');
  
  sermonsCache = [...part1, ...part2, ...part3, ...part4, ...part5];
  console.log(`Loaded ${sermonsCache.length} sermons from 5 parts`);
  return sermonsCache;
}

exports.handler = async (event, context) => {
  try {
    const { query } = JSON.parse(event.body || '{}');
    if (!query) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Query required' }) };
    }
    
    const sermons = loadAllSermons();
    const queryLower = query.toLowerCase();
    
    // Simple search
    const results = sermons.filter(s => 
      s && (s.title?.toLowerCase().includes(queryLower) || 
            s.transcript?.toLowerCase().includes(queryLower))
    ).slice(0, 10);
    
    let grokAnalysis = 'Analyzing...';
    const GROK_API_KEY = process.env.GROK_API_KEY;
    
    if (GROK_API_KEY && results.length > 0) {
      try {
        const excerpts = results
          .filter(s => s.transcript)
          .slice(0, 2)
          .map(s => s.transcript.substring(0, 800))
          .join('\n\n');
        
        grokAnalysis = await callGrok(excerpts, query, GROK_API_KEY);
      } catch (error) {
        console.error('Grok error:', error);
        grokAnalysis = `Pastor Bob has ${results.length} sermon${results.length > 1 ? 's' : ''} on "${query}". See the videos below for his teaching.`;
      }
    } else {
      grokAnalysis = results.length > 0 
        ? `Found ${results.length} relevant sermons on "${query}".`
        : 'No sermons found. Try different keywords.';
    }
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grokSynthesis: grokAnalysis,
        sermons: results.map(s => ({
          id: s.id,
          title: s.title,
          url: s.url,
          word_count: s.word_count,
          youtubeVideo: s.url ? {
            youtubeUrl: s.url,
            date: extractDate(s.title),
            scripture: s.title.split('|')[0]?.trim() || ''
          } : null
        })),
        totalResults: results.length
      })
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

async function callGrok(excerpts, query, apiKey) {
  const https = require('https');
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      req.destroy();
      resolve(`Pastor Bob addresses "${query}" in multiple sermons. His teaching emphasizes biblical truth and practical application. See the sermon videos below for his full exposition.`);
    }, 10000); // 10 second timeout with good fallback
    
    const prompt = `Summarize Pastor Bob Kopeny's teaching on "${query}" in 3 concise paragraphs based on these sermon excerpts:\n\n${excerpts}`;
    
    const data = JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      model: 'grok-3',
      temperature: 0.7,
      max_tokens: 600
    });

    const options = {
      hostname: 'api.x.ai',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(body);
          if (response.choices?.[0]?.message?.content) {
            resolve(response.choices[0].message.content);
          } else {
            resolve(`Pastor Bob has teaching on "${query}". See the sermon videos below for his exposition.`);
          }
        } catch (e) {
          resolve(`Pastor Bob addresses "${query}" in his sermons. See the videos below for his teaching.`);
        }
      });
    });

    req.on('error', () => {
      clearTimeout(timeout);
      resolve(`See the sermon videos below for Pastor Bob's teaching on "${query}".`);
    });
    
    req.write(data);
    req.end();
  });
}

function extractDate(title) {
  const m = title.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : '';
}
