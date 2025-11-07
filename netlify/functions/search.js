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
        grokAnalysis = await callGrok(results, query, GROK_API_KEY);
      } catch (error) {
        console.error('Grok API error:', error);
        grokAnalysis = 'AI analysis temporarily unavailable. Please check your API key configuration.';
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
  
  // Get substantial content from top sermons
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
  
  const prompt = `You are synthesizing Pastor Bob Kopeny's teaching from Calvary Chapel East Anaheim. Pastor Bob is known for:
- Verse-by-verse expository preaching through entire books of the Bible
- Practical, down-to-earth applications that connect biblical truth to everyday life
- Personal stories and illustrations that make theology accessible
- A warm, pastoral tone that balances depth with clarity
- Emphasis on grace, the sovereignty of God, and practical Christian living

QUESTION: ${query}

TASK: Write a comprehensive 6-8 paragraph synthesis of Pastor Bob's teaching on this topic based on the sermon excerpts below. Structure your response as follows:

**PARAGRAPH 1 - INTRODUCTION:** 
Start with an engaging opening that introduces the topic and Pastor Bob's overall perspective. Mention the biblical foundation.

**PARAGRAPHS 2-3 - THEOLOGICAL FOUNDATION:**
Explain the core biblical/theological principles Pastor Bob teaches on this topic. Include specific scripture references and theological concepts he emphasizes. Be detailed and substantive.

**PARAGRAPHS 4-5 - ILLUSTRATIONS & STORIES:**
Share the specific stories, analogies, or real-life examples Pastor Bob uses to illustrate these truths. These make his teaching memorable - include them in detail.

**PARAGRAPH 6-7 - PRACTICAL APPLICATION:**
Explain how Pastor Bob applies these truths to daily Christian living. What does he tell people to DO with this teaching? What warnings or encouragements does he give?

**PARAGRAPH 8 - CONCLUSION:**
Summarize the heart of his message with a pastoral call to action or encouragement.

Throughout your synthesis, naturally reference "as Pastor Bob teaches in his sermon on [topic]" to indicate where specific points come from.

Write in a warm, accessible, pastoral voice. Make it feel like a comprehensive pastoral teaching that draws from multiple sermons. Be specific, detailed, and substantive - this should be a thorough treatment of the topic.

SERMON EXCERPTS:
${excerpts}

RELATED VIDEO SERMONS:
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
