exports.handler = async (event, context) => {
  try {
    const { query, filterType } = JSON.parse(event.body || '{}');
    
    if (!query) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Query is required' })
      };
    }
    
    const sermons = require('../../PASTOR_BOB_COMPLETE_1654.json');
    
    if (!Array.isArray(sermons)) {
      throw new Error('Sermon database is not an array');
    }
    
    const results = searchSermons(sermons, query, filterType);
    const GROK_API_KEY = process.env.GROK_API_KEY;
    
    let grokAnalysis = null;
    if (GROK_API_KEY && results.length > 0) {
      try {
        grokAnalysis = await callGrok(results, query, GROK_API_KEY);
      } catch (error) {
        console.error('Grok API error:', error);
        grokAnalysis = 'AI analysis temporarily unavailable. Please try again.';
      }
    }
    
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
        error: error.message
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
  }).slice(0, 15);
}

async function callGrok(sermons, query, apiKey) {
  const https = require('https');
  
  // Get MORE content - up to 1500 chars per sermon
  const excerpts = sermons
    .filter(s => s && s.transcript)
    .slice(0, 10)
    .map((s, i) => {
      const excerpt = s.transcript.substring(0, 1500);
      return `[Sermon ${i + 1}]\n${excerpt}`;
    })
    .join('\n\n---\n\n');
  
  const prompt = `You are analyzing Pastor Bob Kopeny's sermons from Calvary Chapel East Anaheim. He is known for his expository teaching, practical applications, personal illustrations, and pastoral warmth.

QUESTION: ${query}

TASK: Based on these sermon excerpts, write a comprehensive synthesis of Pastor Bob's teaching on this topic. Your response should be 4-6 paragraphs and include:

1. OPENING: Introduce the topic and Pastor Bob's overall perspective
2. THEOLOGICAL FOUNDATION: His main biblical/theological points with specific examples from the sermons
3. ILLUSTRATIONS & STORIES: Key stories, analogies, or real-life examples he uses to illustrate these points
4. PRACTICAL APPLICATION: How he applies these truths to daily Christian living
5. PASTORAL EMPHASIS: Any repeated themes, warnings, or encouragements he gives
6. CONCLUSION: Summarize the heart of his message on this topic

Write in a warm, accessible, pastoral voice that mirrors Pastor Bob's teaching style. Be specific and detailed, drawing directly from the sermon content below.

SERMON EXCERPTS:
${excerpts}

Write your comprehensive synthesis (4-6 paragraphs):`;

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      messages: [{ 
        role: 'user', 
        content: prompt 
      }],
      model: 'grok-beta',
      temperature: 0.8,
      max_tokens: 2000
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
      timeout: 45000
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
  
  // Create specific YouTube search that will actually work
  const bookNames = {
    'ROM': 'Romans', 'GEN': 'Genesis', 'EXO': 'Exodus', 'REV': 'Revelation',
    'MAT': 'Matthew', 'JOH': 'John', 'EPH': 'Ephesians', 'GAL': 'Galatians'
  };
  
  const bookName = bookNames[bookCode] || bookCode;
  const chapterNum = parseInt(ch1);
  const verseNum = parseInt(v1);
  
  return {
    playlistId: 'PLEgYquYMZK-S5hMVvpeGJ4U-R627ZIQ94',
    searchQuery: `Bob Kopeny ${bookName} ${chapterNum} ${year}`,
    youtubeUrl: `https://www.youtube.com/results?search_query=Bob+Kopeny+${encodeURIComponent(bookName)}+${chapterNum}+${year}`,
    date: `${year}-${month}-${day}`,
    scripture: `${bookName} ${chapterNum}:${verseNum}`
  };
}
