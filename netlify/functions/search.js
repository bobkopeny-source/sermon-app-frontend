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
    
    const results = sermons.filter(s => 
      s && (s.title?.toLowerCase().includes(queryLower) || 
            s.transcript?.toLowerCase().includes(queryLower))
    ).slice(0, 10);
    
    let grokAnalysis = 'Analyzing...';
    const OPENAI_API_KEY = process.env.opeaikey || process.env.OPENAI_API_KEY;
    
    if (OPENAI_API_KEY && results.length > 0) {
      try {
        const excerpts = results
          .filter(s => s.transcript)
          .slice(0, 3)
          .map(s => s.transcript.substring(0, 1000))
          .join('\n\n');
        
        grokAnalysis = await callOpenAI(excerpts, query, OPENAI_API_KEY);
      } catch (error) {
        console.error('OpenAI error:', error);
        grokAnalysis = `Pastor Bob has ${results.length} sermon${results.length > 1 ? 's' : ''} on "${query}". See the videos below.`;
      }
    } else {
      grokAnalysis = results.length > 0 
        ? `Found ${results.length} sermons on "${query}".`
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

async function callOpenAI(excerpts, query, apiKey) {
  const https = require('https');
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      req.destroy();
      reject(new Error('timeout'));
    }, 8000);
    
    const prompt = `Summarize Pastor Bob Kopeny's teaching on "${query}" in 3-4 detailed paragraphs based on these sermon excerpts. Write in a clear, pastoral tone:\n\n${excerpts}`;
    
    const data = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are summarizing Pastor Bob Kopeny\'s biblical teaching from Calvary Chapel East Anaheim. Write clear, pastoral summaries.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 800
    });

    const options = {
      hostname: 'api.openai.com',
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
            reject(new Error('No content'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });
    
    req.write(data);
    req.end();
  });
}

function extractDate(title) {
  const m = title.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : '';
}
