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
    
    // Find relevant sermons
    const results = sermons.filter(s => 
      s && (s.title?.toLowerCase().includes(queryLower) || 
            s.transcript?.toLowerCase().replace(/\[\d+:\d+:\d+\]/g, " ").includes(queryLower))
    ).slice(0, 10);
    
    let analysis = `Found ${results.length} sermons on "${query}".`;
    const KEY = process.env.opeaikey || process.env.OPENAI_API_KEY;
    
    if (KEY && results.length > 0) {
      try {
        // Get substantial excerpts from sermons that actually mention the topic
        const relevantExcerpts = results
          .filter(s => s.transcript)
          .map(s => {
            const transcript = s.transcript.replace(/\[\d+:\d+:\d+\]/g, ' ');
            const title = s.title || 'Untitled';
            
            // Find where the query appears and get context around it
            const lowerTranscript = transcript.toLowerCase();
            const queryIndex = lowerTranscript.indexOf(queryLower);
            
            let excerpt;
            if (queryIndex !== -1) {
              // Get 1500 chars around where the query appears
              const start = Math.max(0, queryIndex - 500);
              const end = Math.min(transcript.length, queryIndex + 1000);
              excerpt = transcript.substring(start, end);
            } else {
              // Query in title but not transcript - get beginning
              excerpt = transcript.substring(0, 1500);
            }
            
            return `From "${title}":\n${excerpt}`;
          })
          .slice(0, 4)
          .join('\n\n---\n\n');
        
        console.log('Calling OpenAI with relevant excerpts');
        analysis = await callOpenAI(relevantExcerpts, query, KEY);
        
      } catch (e) {
        console.error('OpenAI error:', e.message);
        analysis = `Pastor Bob addresses "${query}" in ${results.length} sermons. His teaching emphasizes biblical truth and practical application for daily Christian living.`;
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
            date: getDate(s.title),
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
    }, 20000);
    
    const prompt = `You are summarizing Pastor Bob Kopeny's biblical teaching on "${query}" from Calvary Chapel East Anaheim.

Below are excerpts from his actual sermons. Write a comprehensive 4-5 paragraph summary of what he teaches about this topic based on these excerpts.

Focus on:
- The biblical foundations he emphasizes
- Practical applications he draws
- Key theological points he makes
- How he connects this to Christian living

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
        if (res.statusCode !== 200) {
          console.error('OpenAI error:', res.statusCode, body);
          return reject(new Error(`OpenAI Status ${res.statusCode}`));
        }
        try {
          const response = JSON.parse(body);
          const content = response.choices?.[0]?.message?.content;
          if (content) {
            resolve(content);
          } else {
            reject(new Error('No content in OpenAI response'));
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

function getDate(title) {
  const m = title.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : '';
}
