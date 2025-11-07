const zlib = require('zlib');
const fs = require('fs');

let sermonsCache = null;

function loadSermons() {
  if (sermonsCache) return sermonsCache;
  
  try {
    const compressed = fs.readFileSync('./PASTOR_BOB_COMPLETE_2072.json.gz');
    const decompressed = zlib.gunzipSync(compressed);
    sermonsCache = JSON.parse(decompressed.toString());
    return sermonsCache;
  } catch (e) {
    console.error('Error loading sermons:', e);
    return [];
  }
}

exports.handler = async (event, context) => {
  try {
    const { query, filterType } = JSON.parse(event.body || '{}');
    
    if (!query) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Query is required' })
      };
    }
    
    const sermons = loadSermons();
    
    if (!Array.isArray(sermons) || sermons.length === 0) {
      throw new Error('Sermon database could not be loaded');
    }
    
    const results = searchSermons(sermons, query, filterType);
    const GROK_API_KEY = process.env.GROK_API_KEY;
    
    console.log('API Key exists:', !!GROK_API_KEY);
    console.log('API Key starts with:', GROK_API_KEY ? GROK_API_KEY.substring(0, 10) : 'none');
    
    let grokAnalysis = null;
    if (GROK_API_KEY && results.length > 0) {
      try {
        grokAnalysis = await callGrok(results, query, GROK_API_KEY);
      } catch (error) {
        console.error('Grok API error details:', error.message);
        grokAnalysis = `AI analysis error: ${error.message}`;
      }
    } else {
      grokAnalysis = 'Grok API key not configured. Please add GROK_API_KEY to Netlify environment variables.';
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
  }).slice(0, 20);
}

async function callGrok(sermons, query, apiKey) {
  const https = require('https');
  
  const sermonData = sermons
    .filter(s => s && s.transcript)
    .slice(0, 12)
    .map((s, i) => {
      const excerpt = s.transcript.substring(0, 2000);
      const videoInfo = extractYouTubeInfo(s);
      return {
        excerpt,
        title: s.title,
        videoInfo
      };
    });
  
  const excerpts = sermonData.map((s, i) => 
    `[Sermon ${i + 1}: ${s.title}]\n${s.excerpt}`
  ).join('\n\n---\n\n');
  
  const videoList = sermonData
    .filter(s => s.videoInfo)
    .map((s, i) => `${i + 1}. ${s.videoInfo.scripture || s.title} - ${s.videoInfo.youtubeUrl}`)
    .join('\n');
  
  const prompt = `You are synthesizing Pastor Bob Kopeny's teaching from Calvary Chapel East Anaheim. Pastor Bob is known for verse-by-verse expository preaching, practical applications, personal stories, and pastoral warmth.

QUESTION: ${query}

TASK: Write a comprehensive 6-8 paragraph synthesis of Pastor Bob's teaching on this topic based on the sermon excerpts below.

Structure:
1. Introduction with biblical foundation
2-3. Core theological principles with scripture references  
4-5. Stories, analogies, and illustrations Pastor Bob uses
6-7. Practical applications for daily Christian living
8. Conclusion with pastoral encouragement

Write in a warm, accessible pastoral voice. Be specific and detailed.

SERMON EXCERPTS:
${excerpts}

RELATED VIDEOS:
${videoList}

Write your comprehensive synthesis (6-8 substantial paragraphs):`;

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      messages: [{ 
        role: 'user', 
        content: prompt 
      }],
      model: 'grok-beta',
      temperature: 0.85,
      max_tokens: 3000
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
      timeout: 60000
    };

    const req = https.request(options, (res) => {
      let body = '';
      
      console.log('Grok API status:', res.statusCode);
      
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          
          if (res.statusCode !== 200) {
            console.error('Grok API error response:', body);
            reject(new Error(`API returned ${res.statusCode}: ${response.error?.message || body}`));
            return;
          }
          
          if (response.choices && response.choices[0]) {
            resolve(response.choices[0].message.content);
          } else {
            reject(new Error('Invalid Grok API response structure'));
          }
        } catch (e) {
          reject(new Error(`Failed to parse API response: ${e.message}`));
        }
      });
    });

    req.on('error', (e) => {
      console.error('Request error:', e);
      reject(new Error(`Network error: ${e.message}`));
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout after 60 seconds'));
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
  
  const bookNames = {
    'ROM': 'Romans', 'GEN': 'Genesis', 'EXO': 'Exodus', 'REV': 'Revelation',
    'MAT': 'Matthew', 'JOH': 'John', 'EPH': 'Ephesians', 'GAL': 'Galatians',
    'PSA': 'Psalms', 'PRO': 'Proverbs', 'ISA': 'Isaiah', 'JER': 'Jeremiah'
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
