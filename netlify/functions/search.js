const https = require('https');

exports.handler = async (event, context) => {
  const { query, filterType } = JSON.parse(event.body);
  const sermons = require('../../PASTOR_BOB_COMPLETE_1654.json');
  
  const results = searchSermons(sermons, query, filterType);
  const GROK_API_KEY = process.env.GROK_API_KEY;
  const grokAnalysis = await callGrok(results, query, GROK_API_KEY);
  const resultsWithVideos = matchYouTubeVideos(results);
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      grokSynthesis: grokAnalysis,
      sermons: resultsWithVideos,
      totalResults: resultsWithVideos.length
    })
  };
};

function searchSermons(sermons, query, filterType) {
  return sermons.filter(sermon => {
    const searchText = `${sermon.title} ${sermon.transcript}`.toLowerCase();
    return searchText.includes(query.toLowerCase());
  }).slice(0, 20);
}

async function callGrok(sermons, query, apiKey) {
  const excerpts = sermons.map(s => 
    s.transcript.substring(0, 500)
  ).join('\n\n---\n\n');
  
  const prompt = `You are analyzing Pastor Bob Kopeny's sermons. 

Question: ${query}

Based on these sermon excerpts, synthesize Pastor Bob's teaching. Include his main points, illustrations, and applications.

Excerpts:
${excerpts}

Provide a 2-3 paragraph synthesis in a pastoral voice.`;

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      model: 'grok-beta',
      temperature: 0.7
    });

    const options = {
      hostname: 'api.x.ai',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          resolve(response.choices[0].message.content);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function matchYouTubeVideos(sermons) {
  return sermons.map(sermon => ({
    ...sermon,
    youtubeVideo: extractYouTubeInfo(sermon)
  }));
}

function extractYouTubeInfo(sermon) {
  const match = sermon.title.match(/(\d{8})-(\d{2})-(\w{3})-(\d{3})-(\d{3})-(\d{3})-(\d{3})/);
  if (!match) return null;
  
  const [_, date, bookNum, bookCode, ch1, v1, ch2, v2] = match;
  
  return {
    playlistId: 'PLEgYquYMZK-S5hMVvpeGJ4U-R627ZIQ94',
    searchQuery: `${bookCode} ${parseInt(ch1)}:${parseInt(v1)} ${date}`,
    date: `${date.substring(0,4)}-${date.substring(4,6)}-${date.substring(6,8)}`
  };
}
