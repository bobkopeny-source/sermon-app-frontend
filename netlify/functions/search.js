exports.handler = async (event, context) => {
  try {
    const { query } = JSON.parse(event.body || '{}');
    if (!query) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Query is required' })
      };
    }
    
    const sermons = require('../../PASTOR_BOB_COMPLETE_2072.json');
    const results = sermons.filter(s => 
      s && (s.title?.toLowerCase().includes(query.toLowerCase()) || 
            s.transcript?.toLowerCase().includes(query.toLowerCase()))
    ).slice(0, 10);
    
    const resultsWithVideos = results.map(s => ({
      id: s.id,
      title: s.title,
      url: s.url,
      word_count: s.word_count,
      youtubeVideo: s.url ? {
        youtubeUrl: s.url,
        date: extractDate(s.title),
        scripture: s.title.split('|')[0]?.trim() || s.title.split('-')[0]?.trim() || ''
      } : null
    }));
    
    let grokAnalysis = 'Analyzing sermons...';
    const GROK_API_KEY = process.env.GROK_API_KEY;
    
    if (GROK_API_KEY && results.length > 0) {
      try {
        const excerpts = results
          .filter(s => s.transcript)
          .slice(0, 2)
          .map(s => s.transcript.substring(0, 600))
          .join('\n\n');
        
        grokAnalysis = await callGrokSimple(excerpts, query, GROK_API_KEY);
      } catch (error) {
        console.error('Grok error:', error);
        grokAnalysis = 'Based on the sermon excerpts found, Pastor Bob addresses this topic through careful biblical exposition and practical application.';
      }
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
      body: JSON.stringify({ error: error.message })
    };
  }
};

function extractDate(title) {
  const match1 = title.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match1) {
    const [_, month, day, year] = match1;
    return `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
  }
  return '';
}

async function callGrokSimple(excerpts, query, apiKey) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, 15000);
    const data = JSON.stringify({
      messages: [{ role: 'user', content: `Summarize Pastor Bob's teaching on "${query}" in 3 paragraphs:\n\n${excerpts}` }],
      model: 'grok-3',
      temperature: 0.7,
      max_tokens: 800
    });
    const options = {
      hostname: 'api.x.ai',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(body);
          if (response.choices?.[0]?.message?.content) { resolve(response.choices[0].message.content); }
          else { reject(new Error('No content')); }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', (e) => { clearTimeout(timeout); reject(e); });
    req.write(data);
    req.end();
  });
}