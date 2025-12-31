// Fast vector search with guest speaker filtering and smart timestamps
const https = require('https');

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const OPENAI_API_KEY = process.env.opeaikey || process.env.OPENAI_API_KEY;

exports.handler = async (event) => {
  try {
    const { query } = JSON.parse(event.body || '{}');
    
    console.log(`Searching for: ${query}`);
    
    // 1. Create embedding for query
    const embedding = await createEmbedding(query);
    console.log('Created embedding');
    
    // 2. Search Qdrant
    let sermons = await searchQdrant(embedding);
    
    console.log(`Found ${sermons.length} sermons from Qdrant`);
    
    // 3. Filter out guest speakers
    sermons = sermons.filter(s => !isGuestSpeaker(s));
    
    console.log(`After guest filter: ${sermons.length} sermons`);
    
    if (sermons.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paragraphs: [`I couldn't find sermons about "${query}".`],
          citations: [],
          illustration: null,
          quotation: null,
          videos: []
        })
      };
    }
    
    // 4. Add timestamps to URLs
    const sermonsWithTimestamps = sermons.map(s => addTimestamp(s, query));
    
    // 5. Find illustration
    const illustration = findIllustration(sermonsWithTimestamps);
    
    // 6. Find famous quote
    const quotation = findFamousQuote(sermonsWithTimestamps);
    
    // 7. Synthesize answer
    const paragraphs = await synthesizeAnswer(sermonsWithTimestamps, query);
    
    // 8. Build response
    const citations = sermonsWithTimestamps.map(s => ({
      id: s.id,
      title: s.title,
      url: s.timestampedUrl || s.url,
      date: s.date,
      scripture: s.scripture
    }));
    
    const videos = sermonsWithTimestamps.map(s => ({
      title: s.title,
      youtubeVideo: {
        youtubeUrl: s.timestampedUrl || s.url,
        scripture: s.scripture,
        date: s.date
      }
    }));
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paragraphs,
        citations,
        illustration,
        quotation,
        videos
      })
    };
    
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

function isGuestSpeaker(sermon) {
  const title = sermon.title || '';
  
  // Filter patterns for guest speakers
  const guestPatterns = [
    /LESSON \d+/i,  // "LESSON 1", "LESSON 2"
    /^[A-Z\s\-\d]+$/,  // ALL CAPS titles (but allow dashes and numbers)
    /Guest Speaker/i,
    /Special Guest/i,
    /- Part \d+ -/i  // Series by guests often formatted "TITLE - Part 1 - Speaker"
  ];
  
  // Check if title has too many consecutive capital letters (likely guest/series)
  const capsWords = title.match(/\b[A-Z]{2,}\b/g) || [];
  if (capsWords.length >= 3) {
    console.log(`Filtering guest speaker: ${title} (too many caps)`);
    return true;
  }
  
  for (const pattern of guestPatterns) {
    if (pattern.test(title)) {
      console.log(`Filtering guest speaker: ${title}`);
      return true;
    }
  }
  
  return false;
}

function addTimestamp(sermon, query) {
  if (!sermon.url || !sermon.transcript) return sermon;
  
  const transcript = sermon.transcript;
  const title = sermon.title || '';
  const queryLower = query.toLowerCase();
  const transcriptLower = transcript.toLowerCase();
  
  // For Sunday/Wednesday Morning Live, skip first 10 minutes (worship)
  let searchStartPos = 0;
  if (title.includes('Sunday Morning Live') || title.includes('Wednesday Night Live')) {
    // Find timestamp around 10 minutes (600 seconds)
    const tenMinMatch = transcript.match(/\[0:1[0-5]:\d+\]/);
    if (tenMinMatch) {
      searchStartPos = tenMinMatch.index;
    }
  }
  
  // Find where query appears (after worship if applicable)
  const queryPos = transcriptLower.indexOf(queryLower, searchStartPos);
  if (queryPos === -1) {
    // Query not found in transcript - use default start position
    if (searchStartPos > 0) {
      // For live services, default to 10 minutes
      const url = sermon.url;
      if (url.includes('youtube.com') || url.includes('youtu.be')) {
        const separator = url.includes('?') ? '&' : '?';
        sermon.timestampedUrl = `${url}${separator}t=600s`;
      }
    }
    return sermon;
  }
  
  // Extract all timestamps from transcript
  const timestampRegex = /\[(\d+):(\d+):(\d+)\]/g;
  const timestamps = [];
  let match;
  
  while ((match = timestampRegex.exec(transcript)) !== null) {
    const hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const seconds = parseInt(match[3]);
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    timestamps.push({
      position: match.index,
      seconds: totalSeconds
    });
  }
  
  if (timestamps.length === 0) return sermon;
  
  // Find closest timestamp before query position
  let bestTimestamp = timestamps[0];
  for (const ts of timestamps) {
    if (ts.position <= queryPos) {
      bestTimestamp = ts;
    } else {
      break;
    }
  }
  
  // For live services, ensure we're past the 10-minute mark
  if (title.includes('Sunday Morning Live') || title.includes('Wednesday Night Live')) {
    if (bestTimestamp.seconds < 600) {
      bestTimestamp.seconds = 600; // Jump to 10 minutes
    }
  }
  
  // Add timestamp to URL
  const url = sermon.url;
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    const separator = url.includes('?') ? '&' : '?';
    sermon.timestampedUrl = `${url}${separator}t=${bestTimestamp.seconds}s`;
  }
  
  return sermon;
}

function findIllustration(sermons) {
  const patterns = [
    /i remember (when|a time|one time)/i,
    /let me tell you (about|a story)/i,
    /i'll never forget/i,
    /i once (met|knew|saw|heard)/i,
    /there was (this|a) (man|woman|guy|person|couple|family)/i,
    /years ago.*?(i|we|met|knew|happened)/i,
    /when i was (a|in|at)/i,
    /my (dad|mom|father|mother|friend|pastor) (used to|once|always)/i
  ];
  
  for (const sermon of sermons) {
    if (!sermon.transcript) continue;
    
    const transcript = sermon.transcript;
    
    for (const pattern of patterns) {
      const match = transcript.match(pattern);
      if (match) {
        const pos = match.index;
        const start = Math.max(0, pos - 300);
        const end = Math.min(transcript.length, pos + 3000);
        let story = transcript.substring(start, end);
        
        // Remove timestamps and markers
        story = story.replace(/\[[\d:]+\]/g, '');
        story = story.replace(/\[(Music|Applause|Laughter)\]/gi, '');
        story = story.replace(/\s+/g, ' ').trim();
        
        // Find first complete sentence (skip incomplete start)
        const firstPeriod = story.indexOf('. ');
        if (firstPeriod > 0 && firstPeriod < 200) {
          story = story.substring(firstPeriod + 2); // Start after first period
        }
        
        // Find complete sentences
        const sentences = story.match(/[^.!?]+[.!?]+/g);
        if (sentences && sentences.length >= 3) {
          const cleanStory = sentences.slice(0, 20).join(' '); // Take up to 8 sentences
          
          // Check it's not Bible exposition
          const biblicalWords = ['jesus', 'moses', 'paul', 'peter', 'david'];
          const biblicalCount = biblicalWords.filter(w => cleanStory.toLowerCase().includes(w)).length;
          
          if (biblicalCount < 2 && cleanStory.length >= 100) {
            return {
              text: cleanStory,
              source: sermon.title
            };
          }
        }
      }
    }
  }
  
  return null;
}

function findFamousQuote(sermons) {
  const famousPeople = [
    'Charles Spurgeon', 'Spurgeon', 'Martin Luther', 'Luther', 
    'Augustine', 'John Calvin', 'Calvin', 'John Wesley', 'Wesley', 
    'Jonathan Edwards', 'Edwards', 'C.S. Lewis', 'Lewis', 
    'A.W. Tozer', 'Tozer', 'Dietrich Bonhoeffer', 'Bonhoeffer', 
    'John Piper', 'Piper', 'Blaise Pascal', 'Pascal',
    'Winston Churchill', 'Churchill', 'Abraham Lincoln', 'Lincoln', 
    'George Washington', 'Washington', 'Benjamin Franklin',
    'G.K. Chesterton', 'Chesterton', 'J.R.R. Tolkien', 'Tolkien', 
    'William Wilberforce', 'Wilberforce', 'George MacDonald', 'MacDonald'
  ];
  
  for (const sermon of sermons) {
    if (!sermon.transcript) continue;
    
    let transcript = sermon.transcript;
    
    // Remove timestamps first
    transcript = transcript.replace(/\[[\d:]+\]/g, '');
    
    for (const person of famousPeople) {
      // Stricter patterns - quote must be within 50 chars of name
      const patterns = [
        new RegExp(`${person}\\s+(?:said|wrote|stated|once said)\\s*[,:;]?\\s*"([^"]{20,200})"`, 'i'),
        new RegExp(`(?:as|like)\\s+${person}\\s+(?:said|wrote|put it)\\s*[,:;]?\\s*"([^"]{20,200})"`, 'i'),
        new RegExp(`"([^"]{20,200})"\\s*[,-]?\\s*${person}`, 'i')
      ];
      
      for (const pattern of patterns) {
        const match = transcript.match(pattern);
        if (match && match[1]) {
          const quote = match[1].trim();
          
          // Verify it's not a Bible verse (no verse numbers)
          if (!/\d+:\d+/.test(quote)) {
            return {
              text: quote,
              author: person,
              source: sermon.title
            };
          }
        }
      }
    }
  }
  
  return null;
}

async function createEmbedding(text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'text-embedding-3-small',
      input: text
    });
    
    const options = {
      hostname: 'api.openai.com',
      path: '/v1/embeddings',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const response = JSON.parse(data);
        resolve(response.data[0].embedding);
      });
    });
    
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function searchQdrant(embedding) {
  const url = new URL(QDRANT_URL);
  
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      vector: embedding,
      limit: 8,  // Get more results for filtering
      with_payload: true
    });
    
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: '/collections/pastor_bob_sermons/points/search',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': QDRANT_API_KEY,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          console.log('Qdrant response:', JSON.stringify(response).substring(0, 500));
          
          if (response.result && Array.isArray(response.result)) {
            // Filter by score and word count
            const sermons = response.result
              .filter(r => r.score >= 0.28)
              .map(r => r.payload)
              .filter(s => !s.word_count || s.word_count >= 1000)
              .slice(0, 4);  // Take top 4 after filtering
            resolve(sermons);
          } else {
            console.error('Unexpected Qdrant response:', response);
            resolve([]);
          }
        } catch (err) {
          console.error('Error parsing Qdrant response:', err, data);
          resolve([]);
        }
      });
    });
    
    req.on('error', (err) => {
      console.error('Qdrant request error:', err);
      reject(err);
    });
    req.write(body);
    req.end();
  });
}

async function synthesizeAnswer(sermons, query) {
  const context = sermons.map((s, i) => {
    const excerpt = (s.transcript || '').substring(0, 1200);
    return `[Sermon ${i+1}: "${s.title}"]\n${excerpt}`;
  }).join('\n\n---\n\n');
  
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Synthesize Pastor Bob's teaching. Return ONLY JSON:
{"paragraphs": ["Para 1 with [1]", "Para 2 with [2]", "Para 3 with [3]", "Para 4 with [4]"]}

RULES:
- Each paragraph MUST cite a different sermon [1], [2], [3], [4]
- Include DIRECT QUOTES from Pastor Bob in "quotation marks"
- Write 4 comprehensive paragraphs (4-6 sentences each)
- Use warm, pastoral tone
- Focus on practical application
- CRITICAL: Place citation [N] at the END of each paragraph`
        },
        {
          role: 'user',
          content: `Question: ${query}\n\nSermons:\n${context}`
        }
      ],
      temperature: 0.7,
      max_tokens: 600,
      response_format: { type: 'json_object' }
    });
    
    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          const result = JSON.parse(response.choices[0].message.content);
          const paragraphs = result.paragraphs || [];
          
          // Force add citations if missing
          const withCitations = paragraphs.map((para, i) => {
            if (!para.includes(`[${i+1}]`)) {
              return para + ` [${i+1}]`;
            }
            return para;
          });
          
          resolve(withCitations);
        } catch (err) {
          console.error('Error parsing OpenAI response:', err);
          resolve([`Pastor Bob teaches about ${query} in these sermons. [1]`]);
        }
      });
    });
    
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
