exports.handler = async (event, context) => {
  try {
    // Parse request
    const { query, filterType } = JSON.parse(event.body || '{}');
    
    if (!query) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Query is required' })
      };
    }
    
    // Load sermon database
    const sermons = require('../../PASTOR_BOB_COMPLETE_1654.json');
    
    if (!Array.isArray(sermons)) {
      throw new Error('Sermon database is not an array');
    }
    
    // Search sermons
    const results = searchSermons(sermons, query, filterType);
    
    // Get Grok API key
    const GROK_API_KEY = process.env.GROK_API_KEY;
    
    // Call Grok (only if API key exists)
    let grokAnalysis = null;
    if (GROK_API_KEY && results.length > 0) {
      try {
        grokAnalysis = await callGrok(results, query, GROK_API_KEY);
      } catch (error) {
        console.error('Grok API error:', error);
        grokAnalysis = 'AI analysis temporarily unavailable.';
      }
    }
    
    // Match YouTube videos
    const resultsWithVideos = results.map(sermon => ({
      ...sermon,
      youtubeVideo: extractYouTubeInfo(sermon)
    }));
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grokSynthesis: grokAnalysis,
        sermons: resultsWithVideos,
        totalResults: resultsWithVideos.length
      })
    };
    
  } catch (error) {
    console.error('Search error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: error.message,
        stack: error.stack 
      })
    };
  }
};

function searchSermons(sermons, query, filterType) {
  if (!Array.isArray(sermons)) return [];
  
  const queryLower = query.toLowerCase();
  
  return sermons.filter(sermon => {
    if (!sermon) return false;
    
    const title = (sermon.title || '').toLowerCase();
    const transcript = (sermon.transcript || '').toLowerCase();
    const searchText = `${title} ${transcript}`;
    
    return searchText.includes(queryLower);
  }).slice(0, 20);
}

async function callGrok(sermons, query, apiKey) {
  const https = require('https');
  
  const excerpts = sermons
    .filter(s => s && s.transcript)
    .map(s => s.transcript.substring(0, 500))
    .join('\n\n---\n\n');
  
  const prompt = `You are analyzing Pastor Bob Kopeny's sermons from Calvary Chapel East Anaheim.

Question: ${query}

Based on these sermon excerpts, synthesize Pastor Bob's teaching on this topic. Include:
1. His main theological/biblical points
2. Key illustrations or stories he uses
3. Practical applications he emphasizes

Write in a warm, pastoral voice (2-3 paragraphs).

Excerpts:
${excerpts}`;

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      messages: [{ 
        role: 'user', 
        content: prompt 
      }],
      model: 'grok-beta',
      temperature: 0.7,
      max_tokens: 500
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
      timeout: 30000
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          if (response.choices && response.choices[0]) {
            resolve(response.choices[0].message.content);
          } else {
            reject(new Error('Invalid Grok API response'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Grok API timeout'));
    });
    
    req.write(data);
    req.end();
  });
}

function extractYouTubeInfo(sermon) {
  if (!sermon || !sermon.title) return null;
  
  const match = sermon.title.match(/(\d{8})-(\d{2})-(\w{3})-(\d{3})-(\d{3})-(\d{3})-(\d{3})/);
  if (!match) return null;
  
  const [_, date, bookNum, bookCode, ch1, v1, ch2, v2] = match;
  
  const year = date.substring(0, 4);
  const month = date.substring(4, 6);
  const day = date.substring(6, 8);
  
  return {
    playlistId: 'PLEgYquYMZK-S5hMVvpeGJ4U-R627ZIQ94',
    searchQuery: `Pastor Bob ${bookCode} ${parseInt(ch1)}:${parseInt(v1)}`,
    date: `${year}-${month}-${day}`
  };
}
