// Fast vector search using Qdrant
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
    
    // 2. Search Qdrant
    const sermons = await searchQdrant(embedding);
    
    console.log(`Found ${sermons.length} sermons`);
    
    // 3. Synthesize answer
    const paragraphs = await synthesizeAnswer(sermons, query);
    
    // 4. Build response
    const citations = sermons.map(s => ({
      id: s.id,
      title: s.title,
      url: s.url,
      date: s.date,
      scripture: s.scripture
    }));
    
    const videos = sermons.map(s => ({
      title: s.title,
      youtubeVideo: {
        youtubeUrl: s.url,
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
        illustration: null,
        quotation: null,
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
      limit: 4,
      score_threshold: 0.7
    });
    
    const options = {
      hostname: url.hostname,
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
        const response = JSON.parse(data);
        const sermons = response.result.map(r => r.payload);
        resolve(sermons);
      });
    });
    
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function synthesizeAnswer(sermons, query) {
  // Create context from sermons
  const context = sermons.map((s, i) => {
    const excerpt = s.transcript.substring(0, 1000);
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
Each paragraph must cite a different sermon. Use warm, pastoral tone.`
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
        const response = JSON.parse(data);
        const result = JSON.parse(response.choices[0].message.content);
        resolve(result.paragraphs);
      });
    });
    
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
