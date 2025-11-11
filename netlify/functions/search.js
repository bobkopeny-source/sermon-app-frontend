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
    if (!query) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Query required' }) };
    }
    
    const sermons = loadAllSermons();
    const queryLower = query.toLowerCase();
    
    const results = sermons.filter(s => 
      s && (s.title?.toLowerCase().includes(queryLower) || 
            s.transcript?.toLowerCase().includes(queryLower))
    ).slice(0, 10);
    
    let grokAnalysis = `Found ${results.length} sermons on "${query}". See the videos below.`;
    const OPENAI_API_KEY = process.env.opeaikey || process.env.OPENAI_API_KEY;
    
    if (OPENAI_API_KEY && results.length > 0) {
      try {
        const excerpts = results
          .filter(s => s.transcript)
          .slice(0, 2)
          .map(s => s.transcript.substring(0, 600))
          .join('\n\n---\n\n');
        
        console.log('Calling OpenAI...');
        grokAnalysis = await callOpenAI(excerpts, query, OPENAI_API_KEY);
        console.log('OpenAI response received');
      } catch (error) {
        console.error('OpenAI error:', error.message);
        grokAnalysis = `Pastor Bob addresses "${query}" in ${results.length} sermon${results.length > 1 ? 's' : ''}. His teaching emphasizes biblical truth and practical application. See the sermon videos below for his full exposition on this topic.`;
      }
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
    console.error('Handler error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

async function callOpenAI(excerpts, query, apiKey) {
  const https = require('https');
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      req.destroy();
      reject(new Error('OpenAI timeout after 15s'));
    }, 15000); // Increased to 15 seconds
    
    const prompt = `Based on these excerpts from Pastor Bob Kopeny's sermons, write a 3-paragraph summary of his teaching on "${query}":\n\n${excerpts}`;
    
    const data = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You summarize biblical teaching clearly and concisely in 3 paragraphs.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 500
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
        
        console.log('OpenAI status:', res.statusCode);
        
        if (res.statusCode !== 200) {
          console.error('OpenAI error response:', body);
          reject(new Error(`OpenAI returned ${res.statusCode}`));
          return;
        }
        
        try {
          const response = JSON.parse(body);
          if (response.choices?.[0]?.message?.content) {
            resolve(response.choices[0].message.content);
          } else {
            console.error('No content in response:', response);
            reject(new Error('No content in OpenAI response'));
          }
        } catch (e) {
          console.error('Parse error:', e);
          reject(e);
        }
      });
    });

    req.on('error', (e) => {
      clearTimeout(timeout);
      console.error('Request error:', e);
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
