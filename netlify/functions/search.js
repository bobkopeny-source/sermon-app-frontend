exports.handler = async (event, context) => {
  try {
    const { query, filterType } = JSON.parse(event.body || '{}');
    
    if (!query) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Query is required' })
      };
    }
    
    const sermons = require('../../PASTOR_BOB_COMPLETE_2072.json');
    
    if (!Array.isArray(sermons)) {
      throw new Error('Sermon database is not an array');
    }
    
    const results = searchSermons(sermons, query, filterType);
    const GROK_API_KEY = process.env.GROK_API_KEY;
    
    let grokAnalysis = null;
    if (GROK_API_KEY && results.length > 0) {
      try {
        // Set a timeout promise
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), 25000)
        );
        
        grokAnalysis = await Promise.race([
          callGrok(results, query, GROK_API_KEY),
          timeoutPromise
        ]);
      } catch (error) {
        console.error('Grok API error:', error.message);
        grokAnalysis = `Unable to generate AI synthesis at this time. Please try again.`;
      }
    } else if (!GROK_API_KEY) {
      grokAnalysis = 'AI synthesis unavailable - API key not configured.';
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
  
  // Reduce sermon data to prevent timeout
  const sermonData = sermons
    .filter(s => s && s.transcript)
    .slice(0, 8)
    .map((s) => {
      const excerpt = s.transcript.substring(0, 1200); // Reduced from 2000
      return {
        excerpt,
        title: s.title
      };
    });
  
  const excerpts = sermonData.map((s, i) => 
    `[Sermon ${i + 1}]\n${s.excerpt}`
  ).join('\n\n---\n\n');
  
  const prompt = `You are synthesizing Pastor Bob Kopeny's teaching from Calvary Chapel East Anaheim on the topic: "${query}"

Based on these sermon excerpts, write a comprehensive 5-6 paragraph synthesis covering:
1. Biblical foundation and main principles
2. Key illustrations and stories he uses
3. Practical applications for believers
4. His pastoral emphasis and encouragement

Be specific and detailed. Write in a warm pastoral voice.

EXCERPTS:
${excerpts}

Write your synthesis (5-6 paragraphs):`;

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      messages: [{ 
        role: 'user', 
        content: prompt 
      }],
      model: 'grok-3',
      temperature: 0.8,
      max_tokens: 2000 // Reduced from 3000
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
      timeout: 25000
    };

    const req = https.request(options, (res) => {
      let body = '';
      
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          
          if (res.statusCode !== 200) {
            reject(new Error(`API error ${res.statusCode}`));
            return;
          }
          
          if (response.choices && response.choices[0]) {
            resolve(response.choices[0].message.content);
          } else {
            reject(new Error('Invalid API response'));
          }
        } catch (e) {
          reject(new Error('Failed to parse response'));
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Network timeout'));
    });
    
    req.write(data);
    req.end();
  });
}

function extractYouTubeInfo(sermon) {
  if (!sermon || !sermon.title) return null;
  
  const match = sermon.title.match(/(\d{8})-(\d{2})-(\w{3})-(\d{3})-(\d{3})-(\d{3})-(\d{3})/);
  if (!match) return null;
  
  const [_, date, bookNum, bookCode, ch1, v1] = match;
  
  const year = date.substring(0, 4);
  const month = date.substring(4, 6);
  const day = date.substring(6, 8);
  
  const bookNames = {
    'ROM': 'Romans', 'GEN': 'Genesis', 'EXO': 'Exodus', 'REV': 'Revelation',
    'MAT': 'Matthew', 'JOH': 'John', 'EPH': 'Ephesians', 'GAL': 'Galatians',
    'PSA': 'Psalms', 'PRO': 'Proverbs', 'ISA': 'Isaiah', 'JER': 'Jeremiah'
  };
  
  const bookName = bookNames[bookCode] || bookCode;
  const chapterNum = parseInt(ch1);
  const verseNum = parseInt(v1);
  
  return {
    youtubeUrl: `https://www.youtube.com/results?search_query=Bob+Kopeny+${encodeURIComponent(bookName)}+${chapterNum}+${year}`,
    date: `${year}-${month}-${day}`,
    scripture: `${bookName} ${chapterNum}:${verseNum}`
  };
}
