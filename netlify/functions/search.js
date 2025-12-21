let sermonsCache = null;
let searchIndex = null;

// Load sermon data files
function loadAllSermons() {
  if (sermonsCache) return sermonsCache;
  
  try {
    console.log('Loading sermon files...');
    
    const part1 = require('../../SERMONS_PART_1.json');
    const part2 = require('../../SERMONS_PART_2.json');
    const part3 = require('../../SERMONS_PART_3.json');
    const part4 = require('../../SERMONS_PART_4.json');
    const part5 = require('../../SERMONS_PART_5.json');
    
    sermonsCache = [...part1, ...part2, ...part3, ...part4, ...part5];
    console.log(`Loaded ${sermonsCache.length} sermons from 5 parts`);
    
    // Build search index
    searchIndex = buildSearchIndex(sermonsCache);
    console.log(`Built search index with ${searchIndex.size} unique terms`);
    
    return sermonsCache;
  } catch (error) {
    console.error('Error loading sermon files:', error);
    throw new Error('Failed to load sermon data: ' + error.message);
  }
}

// Initialize search index for faster lookups
function buildSearchIndex(sermons) {
  const index = new Map();
  sermons.forEach((sermon, idx) => {
    if (!sermon) return;
    
    const text = `${sermon.title || ''} ${sermon.scripture || ''} ${sermon.transcript || ''}`.toLowerCase();
    const words = text.match(/\b\w+\b/g) || [];
    
    words.forEach(word => {
      if (word.length > 3) {
        if (!index.has(word)) {
          index.set(word, []);
        }
        index.get(word).push(idx);
      }
    });
  });
  
  return index;
}

// Enhanced relevance scoring
function scoreSermon(sermon, queryWords, fullQuery) {
  let score = 0;
  const text = `${sermon.title || ''} ${sermon.scripture || ''} ${sermon.transcript || ''}`.toLowerCase();
  
  if (text.includes(fullQuery)) {
    score += 100;
  }
  
  const titleLower = (sermon.title || '').toLowerCase();
  queryWords.forEach(word => {
    if (titleLower.includes(word)) score += 20;
  });
  
  const scriptureLower = (sermon.scripture || '').toLowerCase();
  queryWords.forEach(word => {
    if (scriptureLower.includes(word)) score += 15;
  });
  
  const transcriptLower = (sermon.transcript || '').toLowerCase();
  queryWords.forEach(word => {
    const regex = new RegExp(word, 'gi');
    const matches = transcriptLower.match(regex) || [];
    score += matches.length * 2;
  });
  
  if (sermon.date) {
    const year = new Date(sermon.date).getFullYear();
    if (year >= 2023) score += 5;
  }
  
  return score;
}

// Fast search using index and scoring
function searchSermons(query, limit = 10) {
  const sermons = loadAllSermons();
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.match(/\b\w+\b/g) || [];
  
  const candidateIndices = new Set();
  queryWords.forEach(word => {
    if (searchIndex.has(word)) {
      searchIndex.get(word).forEach(idx => candidateIndices.add(idx));
    }
  });
  
  const candidates = candidateIndices.size > 0 
    ? Array.from(candidateIndices).map(idx => sermons[idx]).filter(s => s)
    : sermons;
  
  const scored = candidates
    .filter(s => s && s.transcript)
    .map(sermon => ({
      sermon,
      score: scoreSermon(sermon, queryWords, queryLower)
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  
  return scored.map(item => item.sermon);
}

// Extract relevant excerpts
function extractRelevantExcerpts(sermons, query, maxExcerpts = 5, excerptLength = 1500) {
  const excerpts = [];
  const queryLower = query.toLowerCase();
  
  for (const sermon of sermons.slice(0, maxExcerpts)) {
    if (!sermon || !sermon.transcript) continue;
    
    const transcript = sermon.transcript;
    const transcriptLower = transcript.toLowerCase();
    
    let bestPos = transcriptLower.indexOf(queryLower);
    
    if (bestPos === -1) {
      const words = queryLower.split(/\s+/);
      for (const word of words) {
        const pos = transcriptLower.indexOf(word);
        if (pos !== -1) {
          bestPos = pos;
          break;
        }
      }
    }
    
    if (bestPos === -1) bestPos = 0;
    
    const start = Math.max(0, bestPos - excerptLength / 2);
    const end = Math.min(transcript.length, bestPos + excerptLength / 2);
    let excerpt = transcript.substring(start, end);
    
    if (start > 0) excerpt = '...' + excerpt;
    if (end < transcript.length) excerpt = excerpt + '...';
    
    excerpts.push({
      text: excerpt,
      sermon: sermon
    });
  }
  
  return excerpts;
}

exports.handler = async (event, context) => {
  try {
    const { query, filterType } = JSON.parse(event.body || '{}');
    if (!query) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Query required' }) };
    }
    
    console.log(`Searching for: "${query}"`);
    
    // Fast, relevant search
    const topSermons = searchSermons(query, 10);
    console.log(`Found ${topSermons.length} relevant sermons`);
    
    if (topSermons.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          synthesis: `I couldn't find any sermons directly addressing "${query}". Try different keywords.`,
          videos: []
        })
      };
    }
    
    // Extract excerpts for AI
    const excerpts = extractRelevantExcerpts(topSermons, query, 3, 1000);
    
    // Call OpenAI
    const OPENAI_API_KEY = process.env.opeaikey || process.env.OPENAI_API_KEY;
    
    let synthesis = null;
    if (OPENAI_API_KEY) {
      try {
        console.log('Calling OpenAI...');
        synthesis = await callOpenAI(excerpts, query, OPENAI_API_KEY);
        console.log('OpenAI response received');
      } catch (error) {
        console.error('OpenAI error:', error.message);
        synthesis = `Pastor Bob addresses "${query}" in these sermons. Watch the videos below for his teaching.`;
      }
    } else {
      synthesis = `Pastor Bob addresses "${query}" in these sermons. Watch the videos below for his teaching.`;
    }
    
    // Format response to match frontend expectations
    const videos = topSermons.map(sermon => ({
      title: sermon.title || 'Untitled Sermon',
      youtubeVideo: {
        youtubeUrl: sermon.url,
        scripture: sermon.scripture || '',
        date: sermon.date ? new Date(sermon.date).toLocaleDateString() : ''
      }
    }));
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        synthesis: synthesis,
        videos: videos
      })
    };
    
  } catch (error) {
    console.error('Handler error:', error);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: error.message }) 
    };
  }
};

async function callOpenAI(excerpts, query, apiKey) {
  const https = require('https');
  
  const contextParts = excerpts.map((ex, idx) => {
    return `[Sermon ${idx + 1}: "${ex.sermon.title}"]\n${ex.text}`;
  }).join('\n\n---\n\n');
  
  const requestBody = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are synthesizing Pastor Bob's teaching from sermon transcripts. Write a clear, comprehensive answer in 3-4 well-organized paragraphs. Include direct quotes from Pastor Bob when relevant. Use a warm, pastoral tone. Focus on practical application.`
      },
      {
        role: 'user',
        content: `Question: ${query}\n\nRelevant sermon excerpts:\n${contextParts}\n\nProvide a comprehensive answer about what Pastor Bob teaches on this topic.`
      }
    ],
    temperature: 0.7,
    max_tokens: 600
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(requestBody)
      },
      timeout: 25000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve(response.choices[0].message.content);
        } catch (e) {
          reject(new Error('Failed to parse OpenAI response'));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('OpenAI request timeout'));
    });

    req.write(requestBody);
    req.end();
  });
}
