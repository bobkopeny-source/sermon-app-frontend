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
          .slice(0, 3)
          .map(s => {
            const title = s.title || 'Untitled';
            const text = s.transcript.substring(0, 1000);
            return `From "${title}":\n${text}`;
          })
          .join('\n\n---\n\n');
        
        console.log('Calling OpenAI...');
        analysis = await callOpenAI(excerpts, query, KEY);
        console.log('OpenAI responded successfully');
      } catch (e) {
        console.error('OpenAI error:', e.message);
        analysis = `Pastor Bob addresses "${query}" in ${results.length} sermons. His teaching emphasizes biblical truth and practical application. See the sermon videos below for his full teaching.`;
      }
    }
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grokSynthesis: analysis,
        sermons: results.slice(0, 10).map(s => ({
          id: s.id,
          title: s.title,
          url: s.url,
          word_count: s.word_count,
          youtubeVideo: s.url ? {
            youtubeUrl: s.url,
            date: extractDate(s.title),
            scripture: s.title.split('|')[0]?.trim() || s.title.substring(0, 60)
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

async function callOpenAI(excerpts, query, key) {
  const https = require('https');
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      req.destroy();
      reject(new Error('OpenAI timeout'));
    }, 18000);
    
    const prompt = `Based on these sermon excerpts from Pastor Bob Kopeny at Calvary Chapel East Anaheim, write a comprehensive 4-5 paragraph answer about his teaching on "${query}".

Focus on the theological content, scriptural foundations, and practical applications. Write in a clear, pastoral tone.

${excerpts}

Write your summary:`;
    
    const data = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You summarize Pastor Bob Kopeny\'s biblical teaching clearly and comprehensively in 4-5 paragraphs.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 900
    });

    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
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
          console.error('OpenAI error:', body);
          return reject(new Error(`Status ${res.statusCode}`));
        }
        try {
          const response = JSON.parse(body);
          const content = response.choices?.[0]?.message?.content;
          if (content) {
            resolve(content);
          } else {
            reject(new Error('No content in response'));
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
