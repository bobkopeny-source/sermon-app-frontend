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
    ).slice(0, 15);
    
    let analysis = `Found ${results.length} sermons on "${query}".`;
    const KEY = process.env.opeaikey || process.env.OPENAI_API_KEY;
    
    if (KEY && results.length > 0) {
      try {
        const excerpts = results
          .filter(s => s.transcript)
          .slice(0, 4)
          .map(s => s.transcript.substring(0, 1000))
          .join('\n\n---\n\n');
        
        console.log('Calling OpenAI with', excerpts.length, 'chars');
        analysis = await callOpenAI(excerpts, query, KEY);
        console.log('OpenAI success');
      } catch (e) {
        console.error('OpenAI failed:', e.message);
        analysis = `Pastor Bob has ${results.length} sermons addressing "${query}". His teaching emphasizes biblical truth and practical application.`;
      }
    }
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grokSynthesis: analysis,
        sermons: [],
        totalResults: results.length
      })
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

async function callOpenAI(excerpts, query, key) {
  const https = require('https');
  
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { 
      req.destroy(); 
      reject(new Error('OpenAI timeout after 20s'));
    }, 20000); // Increased to 20 seconds
    
    const prompt = `Based on these excerpts from Pastor Bob Kopeny's sermons at Calvary Chapel East Anaheim, write a comprehensive 4-5 paragraph summary of his biblical teaching on "${query}". 

Write in a clear, pastoral tone. Focus on the theological points, practical applications, and scriptural foundations he emphasizes. Do not include any citations, timestamps, or references.

Sermon excerpts:
${excerpts}

Write the summary:`;
    
    const data = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are summarizing Pastor Bob Kopeny\'s biblical teaching. Write comprehensive, flowing paragraphs without citations.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1000
    });

    const opts = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        clearTimeout(to);
        console.log('OpenAI response status:', res.statusCode);
        if (res.statusCode !== 200) {
          console.error('OpenAI error body:', body);
          return reject(new Error(`OpenAI returned ${res.statusCode}`));
        }
        try {
          const r = JSON.parse(body);
          const content = r.choices?.[0]?.message?.content;
          if (!content) {
            console.error('No content in response');
            return reject(new Error('No content'));
          }
          resolve(content);
        } catch (e) {
          console.error('Parse error:', e);
          reject(e);
        }
      });
    });

    req.on('error', e => { 
      clearTimeout(to); 
      console.error('Request error:', e);
      reject(e); 
    });
    
    req.write(data);
    req.end();
  });
}
