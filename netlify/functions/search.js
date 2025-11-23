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
    
    let aiAnalysis = null;
    const OPENAI_API_KEY = process.env.opeaikey || process.env.OPENAI_API_KEY;
    
    if (OPENAI_API_KEY && results.length > 0) {
      try {
        const excerpts = results
          .filter(s => s.transcript)
          .slice(0, 4)
          .map(s => s.transcript.substring(0, 1200))
          .join('\n\n---\n\n');
        
        console.log('Calling OpenAI...');
        aiAnalysis = await callOpenAI(excerpts, query, OPENAI_API_KEY);
        console.log('OpenAI response received');
      } catch (error) {
        console.error('OpenAI error:', error.message);
        aiAnalysis = `Pastor Bob addresses "${query}" in ${results.length} sermon${results.length > 1 ? 's' : ''}. See the videos below for his full teaching.`;
      }
    }
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grokSynthesis: aiAnalysis,
        sermons: results.map(s => ({
          id: s.id,
          title: s.title,
          url: s.url,
          word_count: s.word_count
        }))
      })
    };
  } catch (error) {
    console.error('Handler error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

async function callOpenAI(excerpts, query, apiKey) {
  const https = require('https');
  
  const requestBody = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are analyzing Pastor Bob\'s sermon transcripts. Provide a comprehensive 3-4 paragraph synthesis of what Pastor Bob teaches about the topic, using his voice and theological perspective. Include specific quotes when helpful.'
      },
      {
        role: 'user',
        content: `Question: ${query}\n\nRelevant sermon excerpts:\n${excerpts}\n\nProvide 3-4 paragraphs that include: 1) Pastor Bob's actual words in quotes, 2) Any illustrations or stories, 3) His pastoral heart and practical application.`
      }
    ],
    temperature: 0.7,
    max_tokens: 700
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(requestBody)
      },
      timeout: 25000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve(response.choices[0].message.content);
        } catch (e) {
          reject(new Error('Failed to parse OpenAI response'));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('OpenAI request timeout'));
    });

    req.write(requestBody);
    req.end();
  });
}
