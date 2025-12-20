let sermonsCache = null;
let searchIndex = null;

// Load sermon data files using require (Netlify Functions compatible)
function loadAllSermons() {
  if (sermonsCache) return sermonsCache;
  
  try {
    console.log('Loading sermon files...');
    
    // Use require with relative paths from functions directory
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
    
    // Extract keywords from title and transcript
    const text = `${sermon.title || ''} ${sermon.scripture || ''} ${sermon.transcript || ''}`.toLowerCase();
    const words = text.match(/\b\w+\b/g) || [];
    
    words.forEach(word => {
      if (word.length > 3) { // Only index meaningful words
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
  
  // Exact phrase match (highest weight)
  if (text.includes(fullQuery)) {
    score += 100;
  }
  
  // Title matches (high weight)
  const titleLower = (sermon.title || '').toLowerCase();
  queryWords.forEach(word => {
    if (titleLower.includes(word)) score += 20;
  });
  
  // Scripture reference matches
  const scriptureLower = (sermon.scripture || '').toLowerCase();
  queryWords.forEach(word => {
    if (scriptureLower.includes(word)) score += 15;
  });
  
  // Transcript matches (moderate weight, with frequency)
  const transcriptLower = (sermon.transcript || '').toLowerCase();
  queryWords.forEach(word => {
    const regex = new RegExp(word, 'gi');
    const matches = transcriptLower.match(regex) || [];
    score += matches.length * 2; // 2 points per occurrence
  });
  
  // Boost recent sermons slightly
  if (sermon.date) {
    const year = new Date(sermon.date).getFullYear();
    if (year >= 2023) score += 5;
  }
  
  return score;
}

// Fast search using index and scoring
function searchSermons(query, limit = 8) {
  const sermons = loadAllSermons();
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.match(/\b\w+\b/g) || [];
  
  // Get candidate sermons from index
  const candidateIndices = new Set();
  queryWords.forEach(word => {
    if (searchIndex.has(word)) {
      searchIndex.get(word).forEach(idx => candidateIndices.add(idx));
    }
  });
  
  // If no index hits, fall back to all sermons
  const candidates = candidateIndices.size > 0 
    ? Array.from(candidateIndices).map(idx => sermons[idx]).filter(s => s)
    : sermons;
  
  // Score and sort
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

// Extract timestamps from transcript
function extractTimestamps(transcript) {
  const timestamps = [];
  const regex = /\[(\d+):(\d+):(\d+)\]/g;
  let match;
  
  while ((match = regex.exec(transcript)) !== null) {
    const hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const seconds = parseInt(match[3]);
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    timestamps.push({
      timestamp: match[0],
      seconds: totalSeconds,
      position: match.index
    });
  }
  
  return timestamps;
}

// Find best excerpts including context around matches
function extractRelevantExcerpts(sermons, query, maxExcerpts = 5, excerptLength = 1500) {
  const excerpts = [];
  const queryLower = query.toLowerCase();
  
  for (const sermon of sermons.slice(0, maxExcerpts)) {
    if (!sermon || !sermon.transcript) continue;
    
    const transcript = sermon.transcript;
    const transcriptLower = transcript.toLowerCase();
    
    // Find best matching position
    let bestPos = transcriptLower.indexOf(queryLower);
    
    // If no exact match, find first occurrence of query words
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
    
    // Default to beginning if no match found
    if (bestPos === -1) bestPos = 0;
    
    // Extract context around match
    const start = Math.max(0, bestPos - excerptLength / 2);
    const end = Math.min(transcript.length, bestPos + excerptLength / 2);
    let excerpt = transcript.substring(start, end);
    
    // Clean up
    if (start > 0) excerpt = '...' + excerpt;
    if (end < transcript.length) excerpt = excerpt + '...';
    
    // Extract timestamps for this sermon
    const timestamps = extractTimestamps(sermon.transcript);
    
    excerpts.push({
      text: excerpt,
      sermon: sermon,
      timestamps: timestamps
    });
  }
  
  return excerpts;
}

// Detect stories and illustrations in transcript
function detectStoriesAndIllustrations(transcript) {
  const indicators = [
    /i remember when/i,
    /there was a (time|story|man|woman)/i,
    /let me (tell you|share)/i,
    /i heard (about|of|a story)/i,
    /picture this/i,
    /imagine (if|that)/i,
    /for example/i,
    /to illustrate/i,
    /here's a story/i,
    /once upon/i
  ];
  
  for (const pattern of indicators) {
    const match = transcript.match(pattern);
    if (match) {
      // Found a story indicator, extract surrounding context
      const pos = match.index;
      const start = Math.max(0, pos - 50);
      const end = Math.min(transcript.length, pos + 500);
      return transcript.substring(start, end);
    }
  }
  
  return null;
}

exports.handler = async (event, context) => {
  try {
    const { query } = JSON.parse(event.body || '{}');
    if (!query) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Query required' }) };
    }
    
    console.log(`Searching for: "${query}"`);
    
    // Fast, relevant search
    const topSermons = searchSermons(query, 8);
    console.log(`Found ${topSermons.length} relevant sermons`);
    
    if (topSermons.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grokSynthesis: `I couldn't find any sermons directly addressing "${query}". Try different keywords or check the spelling.`,
          sermons: []
        })
      };
    }
    
    // Extract smart excerpts with timestamps
    const excerpts = extractRelevantExcerpts(topSermons, query, 5, 1500);
    
    // Look for stories/illustrations
    let storyContext = null;
    for (const sermon of topSermons.slice(0, 3)) {
      const story = detectStoriesAndIllustrations(sermon.transcript || '');
      if (story) {
        storyContext = { text: story, sermon: sermon };
        break;
      }
    }
    
    // Call OpenAI with enhanced prompt
    const OPENAI_API_KEY = process.env.opeaikey || process.env.OPENAI_API_KEY;
    
    let aiResponse = null;
    if (OPENAI_API_KEY) {
      try {
        console.log('Calling OpenAI with enhanced prompt...');
        aiResponse = await callOpenAIEnhanced(excerpts, query, storyContext, OPENAI_API_KEY);
        console.log('OpenAI response received');
      } catch (error) {
        console.error('OpenAI error:', error.message);
      }
    }
    
    // Build response
    const response = buildResponse(aiResponse, topSermons, excerpts, query);
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    };
    
  } catch (error) {
    console.error('Handler error:', error);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: error.message }) 
    };
  }
};

async function callOpenAIEnhanced(excerpts, query, storyContext, apiKey) {
  const https = require('https');
  
  // Build context from excerpts
  const contextParts = excerpts.map((ex, idx) => {
    return `[Sermon ${idx + 1}: "${ex.sermon.title}"]\n${ex.text}`;
  }).join('\n\n---\n\n');
  
  const storyPrompt = storyContext 
    ? `\n\nA potential story/illustration was found:\n${storyContext.text}\n\nIf relevant, incorporate this story.`
    : '';
  
  const requestBody = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are synthesizing Pastor Bob's teaching from his sermon transcripts. 

CRITICAL FORMATTING INSTRUCTIONS:
1. Write 3-4 substantial paragraphs (4-6 sentences each) explaining Pastor Bob's teaching
2. Include direct quotes from Pastor Bob using quotation marks
3. After each paragraph, add citation markers like [1], [2], [3] to reference specific sermons
4. Use a warm, pastoral tone that reflects Pastor Bob's heart
5. Include practical application

STRUCTURE YOUR RESPONSE AS JSON:
{
  "paragraphs": ["paragraph 1 with [1] citations", "paragraph 2 with [2][3] citations", ...],
  "illustration": {
    "text": "A story or illustration from the sermons (if found)",
    "sermon_index": 1
  },
  "quotation": {
    "text": "A memorable quote from a famous source mentioned in the sermons",
    "author": "Author name",
    "sermon_index": 1
  }
}

If no illustration or quotation is found, use null for those fields.`
      },
      {
        role: 'user',
        content: `Question: ${query}\n\nRelevant sermon excerpts:\n${contextParts}${storyPrompt}\n\nProvide a comprehensive answer with citations, an illustration if available, and any famous quotes mentioned.`
      }
    ],
    temperature: 0.7,
    max_tokens: 1200,
    response_format: { type: "json_object" }
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
      timeout: 30000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          const content = response.choices[0].message.content;
          const parsed = JSON.parse(content);
          resolve(parsed);
        } catch (e) {
          console.error('Failed to parse OpenAI response:', e);
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

function buildResponse(aiResponse, sermons, excerpts, query) {
  // Build citations with timestamps
  const citations = excerpts.map((ex, idx) => {
    const sermon = ex.sermon;
    let timestamp = null;
    let timestampSeconds = null;
    
    // Find first timestamp in this excerpt if available
    if (ex.timestamps && ex.timestamps.length > 0) {
      const first = ex.timestamps[0];
      timestamp = first.timestamp.replace(/[\[\]]/g, ''); // Remove brackets
      timestampSeconds = first.seconds;
    }
    
    // Build YouTube URL with timestamp
    let url = sermon.url;
    if (timestampSeconds && url && url.includes('youtube.com')) {
      url = `${url}&t=${timestampSeconds}s`;
    }
    
    return {
      id: sermon.id,
      title: sermon.title || 'Untitled Sermon',
      url: url,
      date: sermon.date ? new Date(sermon.date).toLocaleDateString() : null,
      passage: sermon.scripture || null,
      timestamp: timestamp,
      timestamp_seconds: timestampSeconds
    };
  });
  
  // Default response structure
  let response = {
    paragraphs: [],
    citations: citations,
    illustration: null,
    quotation: null,
    grokSynthesis: '',
    sermons: sermons.map(s => ({
      id: s.id,
      title: s.title,
      url: s.url,
      word_count: s.word_count
    }))
  };
  
  // If AI response available, use it
  if (aiResponse) {
    response.paragraphs = aiResponse.paragraphs || [];
    response.grokSynthesis = response.paragraphs.join('\n\n');
    
    // Add illustration if found
    if (aiResponse.illustration && aiResponse.illustration.text) {
      const sermonIdx = aiResponse.illustration.sermon_index || 0;
      response.illustration = {
        text: aiResponse.illustration.text,
        citation: citations[sermonIdx] || citations[0]
      };
    }
    
    // Add quotation if found
    if (aiResponse.quotation && aiResponse.quotation.text) {
      const sermonIdx = aiResponse.quotation.sermon_index || 0;
      response.quotation = {
        text: aiResponse.quotation.text,
        author: aiResponse.quotation.author || 'Unknown',
        citation: citations[sermonIdx] || citations[0]
      };
    }
  } else {
    // Fallback without AI
    response.grokSynthesis = `Pastor Bob addresses "${query}" in ${sermons.length} sermon${sermons.length > 1 ? 's' : ''}. See the videos below for his full teaching.`;
    response.paragraphs = [response.grokSynthesis];
  }
  
  return response;
}
