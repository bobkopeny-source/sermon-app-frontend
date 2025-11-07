exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  
  try {
    const { query } = JSON.parse(event.body || '{}');
    
    if (!query) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Query is required' })
      };
    }
    
    const sermons = require('../../PASTOR_BOB_COMPLETE_2072.json');
    const results = searchSermons(sermons, query);
    const GROK_API_KEY = process.env.GROK_API_KEY;
    
    const resultsWithVideos = results.map(sermon => ({
      id: sermon.id,
      title: sermon.title,
      url: sermon.url,
      word_count: sermon.word_count,
      youtubeVideo: extractYouTubeInfo(sermon)
    }));
    
    let grokAnalysis = null;
    
    if (GROK_API_KEY && results.length > 0) {
      try {
        grokAnalysis = await Promise.race([
          callGrok(results, query, GROK_API_KEY),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000))
        ]);
      } catch (error) {
        console.error('Grok error:', error.message);
        grokAnalysis = 'AI synthesis temporarily unavailable. Please try again.';
      }
    } else {
      grokAnalysis = 'AI synthesis unavailable.';
    }
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grokSynthesis: grokAnalysis,
        sermons: resultsWithVideos,
        totalResults: resultsWithVideos.length
      })
    };
    
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    };
  }
};

function searchSermons(sermons, query) {
  const queryLower = query.toLowerCase();
  return sermons.filter(s => 
    s && (s.title?.toLowerCase().includes(queryLower) || 
          s.transcript?.toLowerCase().includes(queryLower))
  ).slice(0, 10);
}

async function callGrok(sermons, query, apiKey) {
  const https = require('https');
  
  const excerpts = sermons
    .filter(s => s.transcript)
    .slice(0, 5)
    .map((s, i) => `[Sermon ${i+1}]\n${s.transcript.substring(0, 1000)}`)
    .join('\n\n');
  
  const prompt = `Synthesize Pastor Bob Kopeny's teaching on "${query}" in 4-5 paragraphs covering biblical foundation, illustrations, applications, and emphasis.\n\n${excerpts}`;

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      model: 'grok-3',
      temperature: 0.75,
      max_tokens: 1500
    });

    const options = {
      hostname: 'api.x.ai',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 18000
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk.toString());
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            return reject(new Error(`API error ${res.statusCode}`));
          }
          const response = JSON.parse(body);
          if (response.choices?.[0]?.message?.content) {
            resolve(response.choices[0].message.content);
          } else {
            reject(new Error('No content'));
          }
        } catch (e) {
          reject(new Error('Parse failed'));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

function extractYouTubeInfo(sermon) {
  if (!sermon?.title) return null;
  const match = sermon.title.match(/(\d{8})-(\d{2})-(\w{3})-(\d{3})-(\d{3})/);
  if (!match) return null;
  const [_, date, bookNum, bookCode, ch1, v1] = match;
  const year = date.substring(0, 4);
  const bookNames = {'ROM': 'Romans', 'GEN': 'Genesis', 'EXO': 'Exodus', 'REV': 'Revelation', 'MAT': 'Matthew', 'JOH': 'John'};
  const bookName = bookNames[bookCode] || bookCode;
  const chapterNum = parseInt(ch1);
  return {
    youtubeUrl: `https://www.youtube.com/results?search_query=Bob+Kopeny+${bookName.replace(' ', '+')}+${chapterNum}+${year}`,
    date: `${year}-${date.substring(4, 6)}-${date.substring(6, 8)}`,
    scripture: `${bookName} ${chapterNum}:${parseInt(v1)}`
  };
}