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

// Fast search - limit to 4 best UNIQUE sermons with valid URLs
function searchSermons(query, limit = 4) {
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
    .filter(s => {
      if (!s || !s.transcript || !s.url) return false;
      
      // Filter out worship sets and non-sermon content by title
      const title = (s.title || '').toLowerCase();
      if (title.includes('worship') || title.includes('music')) return false;
      
      // Filter out very short sermons (likely not full sermons)
      if (s.word_count && s.word_count < 1000) return false;
      
      // Check transcript for worship indicators
      const transcript = s.transcript.toLowerCase();
      const worshipPhrases = [
        'sing along', 'worship team', 'praise team', 'opening song',
        'closing song', 'let\'s stand and sing', 'as we worship',
        'worship leader', 'keys of', 'verse 1', 'verse 2', 'chorus',
        'bridge:', 'let\'s worship together', 'hallelujah', 'alleluia',
        'sing it again', 'one more time', 'from the top',
        'lift your hands', 'lift up your voice', '[music]', '[applause]',
        'oh oh oh', 'la la la', 'yeah yeah yeah'
      ];
      
      // If transcript has multiple worship indicators, it's likely a worship set
      let worshipCount = 0;
      for (const phrase of worshipPhrases) {
        if (transcript.includes(phrase)) worshipCount++;
      }
      
      // More aggressive: 2+ worship indicators = worship content (was 3+)
      if (worshipCount >= 2) return false;
      
      // For Sunday Morning Live, require higher word count to ensure it's sermon-heavy
      if (title.includes('sunday morning live') && s.word_count && s.word_count < 2500) {
        return false; // Too short = probably worship portion
      }
      
      return true;
    })
    .map(sermon => ({
      sermon,
      score: scoreSermon(sermon, queryWords, queryLower)
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);
  
  // Deduplicate by URL
  const seenUrls = new Set();
  const uniqueSermons = [];
  
  for (const item of scored) {
    if (!seenUrls.has(item.sermon.url)) {
      seenUrls.add(item.sermon.url);
      uniqueSermons.push(item.sermon);
      if (uniqueSermons.length >= limit) break;
    }
  }
  
  return uniqueSermons;
}

// Extract relevant excerpts
function extractRelevantExcerpts(sermons, query, maxExcerpts = 4, excerptLength = 1200) {
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

// Find best timestamp near query match
function findBestTimestamp(sermon, query) {
  if (!sermon || !sermon.transcript) return null;
  
  const transcript = sermon.transcript;
  const queryPos = transcript.toLowerCase().indexOf(query.toLowerCase());
  
  if (queryPos === -1) return null;
  
  const timestamps = extractTimestamps(transcript);
  if (timestamps.length === 0) return null;
  
  // Find closest timestamp before the query position
  let bestTimestamp = timestamps[0];
  for (const ts of timestamps) {
    if (ts.position <= queryPos) {
      bestTimestamp = ts;
    } else {
      break;
    }
  }
  
  return bestTimestamp.seconds;
}

// Detect stories and illustrations - focus on personal stories
function detectStoriesAndIllustrations(sermons) {
  // Patterns for PERSONAL stories and illustrations
  const personalStoryIndicators = [
    /i remember (when|a time|one time|the time)/i,
    /let me tell you (about|a story)/i,
    /i'll never forget/i,
    /i once (met|knew|saw|heard about)/i,
    /there was (this|a) (man|woman|guy|person|couple|family) (who|that)/i,
    /years ago.*?(met|knew|happened)/i,
    /when i was (a|in|at)/i,
    /my (dad|mom|father|mother|friend|pastor) (used to|once|always)/i,
    /growing up.*?(learned|saw|heard)/i,
    /i heard.*?story (about|of)/i
  ];
  
  for (const sermon of sermons) {
    if (!sermon || !sermon.transcript) continue;
    
    const transcript = sermon.transcript;
    
    // Look for personal story patterns
    for (const pattern of personalStoryIndicators) {
      const match = transcript.match(pattern);
      if (match) {
        const pos = match.index;
        const start = Math.max(0, pos - 200);
        const end = Math.min(transcript.length, pos + 1400);
        let story = transcript.substring(start, end);
        
        // Remove all bracketed content like [3:32:55] and [Music]
        story = story.replace(/\[[^\]]+\]/g, '');
        
        // Remove common song fragments
        story = story.replace(/\b(hallelujah|alleluia|oh oh oh|la la la)\b/gi, '');
        
        // Clean up extra whitespace
        story = story.replace(/\s+/g, ' ').trim();
        
        // Find first complete sentence (after a period + space or capital letter start)
        const sentences = story.match(/[A-Z][^.!?]*[.!?]/g);
        if (sentences && sentences.length > 2) {
          // Skip first sentence if it's incomplete, take from second sentence
          const firstProperSentence = story.indexOf(sentences[1]);
          if (firstProperSentence > 0 && firstProperSentence < 200) {
            story = story.substring(firstProperSentence);
          }
        }
        
        // End at a complete sentence
        const lastPeriod = story.lastIndexOf('. ');
        if (lastPeriod > 400) { // Keep if we have enough content before it
          story = story.substring(0, lastPeriod + 1);
        }
        
        // Verify it's not just Bible exposition
        const lowerStory = story.toLowerCase();
        const biblicalWords = ['jesus', 'moses', 'paul', 'peter', 'abraham', 'david', 'scripture', 'bible', 'verse'];
        const biblicalCount = biblicalWords.filter(word => lowerStory.includes(word)).length;
        
        // If less than 2 biblical words, it's likely a personal story
        if (biblicalCount < 2) {
          return {
            text: story,
            sermon: sermon
          };
        }
      }
    }
  }
  
  return null;
}

// Detect famous quotes
function detectFamousQuotes(sermons) {
  // Common patterns for famous people mentioned
  const famousPeople = [
    'Spurgeon', 'Luther', 'Augustine', 'Calvin', 'Wesley', 'Edwards',
    'C.S. Lewis', 'Lewis', 'Tozer', 'Bonhoeffer', 'Piper', 'Pascal',
    'Churchill', 'Lincoln', 'Washington', 'Franklin', 'Jefferson',
    'Chesterton', 'Dostoevsky', 'Tolkien', 'Wilberforce'
  ];
  
  for (const sermon of sermons) {
    if (!sermon || !sermon.transcript) continue;
    
    const transcript = sermon.transcript;
    
    for (const person of famousPeople) {
      const regex = new RegExp(`${person}[^.]*(?:said|wrote|stated|once said)[^.]*[.!?]`, 'i');
      const match = transcript.match(regex);
      
      if (match) {
        // Try to extract the actual quote
        const quoteMatch = transcript.substring(match.index, match.index + 500)
          .match(/"([^"]+)"/);
        
        if (quoteMatch) {
          return {
            text: quoteMatch[1],
            author: person,
            sermon: sermon
          };
        }
      }
    }
  }
  
  return null;
}

exports.handler = async (event, context) => {
  try {
    const { query, filterType } = JSON.parse(event.body || '{}');
    if (!query) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Query required' }) };
    }
    
    console.log(`Searching for: "${query}"`);
    
    // Fast search - 4 best sermons only
    const topSermons = searchSermons(query, 4);
    console.log(`Found ${topSermons.length} relevant sermons`);
    
    if (topSermons.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paragraphs: [`I couldn't find any sermons directly addressing "${query}". Try different keywords.`],
          citations: [],
          illustration: null,
          quotation: null,
          videos: []
        })
      };
    }
    
    // Extract excerpts for AI
    const excerpts = extractRelevantExcerpts(topSermons, query, 4, 1200);
    
    // Look for stories and quotes
    const illustration = detectStoriesAndIllustrations(topSermons);
    const quotation = detectFamousQuotes(topSermons);
    
    // Call OpenAI for structured response
    const OPENAI_API_KEY = process.env.opeaikey || process.env.OPENAI_API_KEY;
    
    let aiResponse = null;
    if (OPENAI_API_KEY) {
      try {
        console.log('Calling OpenAI...');
        aiResponse = await callOpenAIEnhanced(excerpts, query, illustration, quotation, OPENAI_API_KEY);
        console.log('OpenAI response received');
      } catch (error) {
        console.error('OpenAI error:', error.message);
      }
    }
    
    // Build citations with timestamps
    const citations = topSermons.map((sermon, idx) => {
      const timestampSeconds = findBestTimestamp(sermon, query);
      let url = sermon.url;
      
      // Add timestamp to YouTube URLs
      if (timestampSeconds && url && url.includes('youtube.com')) {
        url = `${url}${url.includes('?') ? '&' : '?'}t=${timestampSeconds}s`;
      }
      
      return {
        id: sermon.id,
        title: sermon.title || 'Untitled Sermon',
        url: url,
        date: sermon.date ? new Date(sermon.date).toLocaleDateString() : null,
        scripture: sermon.scripture || null
      };
    });
    
    // Build response
    let response = {
      paragraphs: [],
      citations: citations,
      illustration: null,
      quotation: null,
      videos: topSermons.map(sermon => ({
        title: sermon.title || 'Untitled Sermon',
        youtubeVideo: {
          youtubeUrl: sermon.url,
          scripture: sermon.scripture || '',
          date: sermon.date ? new Date(sermon.date).toLocaleDateString() : ''
        }
      }))
    };
    
    if (aiResponse && aiResponse.paragraphs) {
      response.paragraphs = aiResponse.paragraphs;
    } else {
      response.paragraphs = [`Pastor Bob addresses "${query}" in these sermons. See the videos below for his teaching.`];
    }
    
    // Add illustration if found
    if (illustration) {
      response.illustration = {
        text: illustration.text,
        source: illustration.sermon.title
      };
    }
    
    // Add quotation if found
    if (quotation) {
      response.quotation = {
        text: quotation.text,
        author: quotation.author,
        source: quotation.sermon.title
      };
    }
    
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

async function callOpenAIEnhanced(excerpts, query, illustration, quotation, apiKey) {
  const https = require('https');
  
  const contextParts = excerpts.map((ex, idx) => {
    return `[Sermon ${idx + 1}: "${ex.sermon.title}"]\n${ex.text}`;
  }).join('\n\n---\n\n');
  
  const illustrationPrompt = illustration 
    ? `\n\nA sermon illustration was found:\n${illustration.text}`
    : '';
  
  const quotationPrompt = quotation
    ? `\n\nA quote from ${quotation.author}: "${quotation.text}"`
    : '';
  
  const requestBody = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are synthesizing Pastor Bob's teaching from sermon transcripts.

CRITICAL: Return ONLY valid JSON with this exact structure:
{
  "paragraphs": [
    "First paragraph with citation [1]",
    "Second paragraph with citation [2]",
    "Third paragraph with citation [3]",
    "Fourth paragraph with citation [4]"
  ]
}

CITATION RULES:
- You MUST use all 4 citations: [1], [2], [3], [4]
- Each paragraph should cite a DIFFERENT sermon (spread them out)
- Paragraph 1 must include [1]
- Paragraph 2 must include [2]  
- Paragraph 3 must include [3]
- Paragraph 4 must include [4]
- You may use multiple citations per paragraph if relevant

CONTENT RULES:
- Write 4 comprehensive paragraphs (4-6 sentences each)
- Include direct quotes from Pastor Bob
- Use warm, pastoral tone
- Include practical application
- Focus on what Pastor Bob actually teaches`
      },
      {
        role: 'user',
        content: `Question: ${query}\n\nSermon excerpts:\n${contextParts}${illustrationPrompt}${quotationPrompt}\n\nProvide comprehensive answer with inline citations.`
      }
    ],
    temperature: 0.7,
    max_tokens: 700,
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
      timeout: 25000
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
