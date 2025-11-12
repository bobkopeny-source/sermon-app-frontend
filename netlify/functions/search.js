let sermonsCache = null;

function loadAllSermons() {
  if (sermonsCache) return sermonsCache;
  
  const part1 = require('../../SERMONS_PART_1.json');
  const part2 = require('../../SERMONS_PART_2.json');
  const part3 = require('../../SERMONS_PART_3.json');
  const part4 = require('../../SERMONS_PART_4.json');
  const part5 = require('../../SERMONS_PART_5.json');
  
  sermonsCache = [...part1, ...part2, ...part3, ...part4, ...part5];
  console.log(`Loaded ${sermonsCache.length} sermons`);
  return sermonsCache;
}

exports.handler = async (event, context) => {
  try {
    const { query } = JSON.parse(event.body || '{}');
    if (!query) return { statusCode: 400, body: JSON.stringify({ error: 'Query required' }) };
    
    const sermons = loadAllSermons();
    const queryLower = query.toLowerCase();
    
    const results = sermons.filter(s => 
      s && (s.title?.toLowerCase().includes(queryLower) || 
            s.transcript?.toLowerCase().replace(/\[\d+:\d+:\d+\]/g, " ").includes(queryLower))
    ).sort((a, b) => {
      const aHas = a.transcript?.match(/\[\d+:\d+:\d+\]/);
      const bHas = b.transcript?.match(/\[\d+:\d+:\d+\]/);
      return (aHas ? -1 : 0) - (bHas ? -1 : 0);
    }).slice(0, 15);
    
    let analysis = `Found ${results.length} sermons.`;
    const KEY = process.env.opeaikey || process.env.OPENAI_API_KEY;
    
    if (KEY && results.length > 0) {
      try {
        const segments = extractTimestampedSegments(results, queryLower);
        
        if (segments.length >= 3) {
          console.log(`Found ${segments.length} timestamped segments`);
          analysis = await generateWithCitations(segments, query, KEY);
        } else {
          console.log('Not enough timestamps, using simple summary');
          const excerpts = results.filter(s => s.transcript).slice(0, 3)
            .map(s => s.transcript.substring(0, 800)).join('\n\n');
          analysis = await generateSimple(excerpts, query, KEY);
        }
      } catch (e) {
        console.error('AI error:', e.message);
        analysis = `Pastor Bob addresses "${query}" in ${results.length} sermons. See the videos below.`;
      }
    }
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grokSynthesis: analysis,
        sermons: results.slice(0, 10).map(s => ({
          id: s.id, title: s.title, url: s.url, word_count: s.word_count,
          youtubeVideo: s.url ? { 
            youtubeUrl: s.url, 
            date: extractDate(s.title), 
            scripture: s.title.split('|')[0]?.trim() || s.title.substring(0, 60)
          } : null
        })),
        totalResults: results.length
      })
    };
  } catch (error) {
    console.error('Handler error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

function extractTimestampedSegments(sermons, query) {
  const segments = [];
  
  for (const sermon of sermons) {
    if (!sermon.transcript || !sermon.url) continue;
    if (!sermon.transcript.match(/\[\d+:\d+:\d+\]/)) continue;
    
    const lines = sermon.transcript.split(/\[(\d+):(\d+):(\d+)\]/).filter(x => x);
    
    for (let i = 0; i < lines.length - 1; i += 4) {
      if (i + 3 >= lines.length) break;
      
      const h = lines[i];
      const m = lines[i + 1];
      const s = lines[i + 2];
      const text = lines[i + 3];
      
      if (!text || text.length < 100) continue;
      
      const cleanText = text.substring(0, 500).trim();
      if (!cleanText.toLowerCase().includes(query)) continue;
      
      const timestamp = `${m}:${s}`;
      const totalSecs = parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s);
      const date = getDateLong(sermon.title);
      
      if (date) {
        segments.push({
          text: cleanText,
          timestamp: timestamp,
          date: date,
          url: `${sermon.url}&t=${totalSecs}s`,
          title: sermon.title.split('|')[0]?.trim() || ''
        });
        
        if (segments.length >= 8) return segments;
      }
    }
  }
  
  return segments;
}

async function generateWithCitations(segments, query, key) {
  const https = require('https');
  
  // Build numbered source list
  const sources = segments.map((seg, i) => 
    `[${i + 1}] ${seg.timestamp} on ${seg.date} - "${seg.title}"\n"${seg.text.substring(0, 300)}..."`
  ).join('\n\n');
  
  const prompt = `You are writing about Pastor Bob Kopeny's teaching on "${query}" from Calvary Chapel East Anaheim.

I will give you numbered sources [1], [2], [3], etc. Each has a specific timestamp.

YOUR JOB: Write 3-4 paragraphs. After each claim, add the source number like this: [1] or [2] or [3]

CRITICAL: Use DIFFERENT source numbers throughout your response. Don't repeat [1] everywhere.

SOURCES:
${sources}

Now write 3-4 paragraphs about "${query}", citing sources as [1], [2], [3], etc:`;

  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, 18000);
    
    const data = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You cite sources using [1], [2], [3] format. Use different numbers for different claims.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 900
    });

    const opts = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        clearTimeout(to);
        if (res.statusCode !== 200) return reject(new Error(`Status ${res.statusCode}`));
        try {
          const r = JSON.parse(body);
          const text = r.choices?.[0]?.message?.content || '';
          
          // Replace [1], [2], [3] with actual clickable links
          let result = text;
          segments.forEach((seg, i) => {
            const num = i + 1;
            const regex = new RegExp(`\\[${num}\\]`, 'g');
            const link = `<a href="${seg.url}" target="_blank" class="cite-link" title="Watch at ${seg.timestamp}">([${seg.timestamp} from ${seg.date}])</a>`;
            result = result.replace(regex, link);
          });
          
          resolve(result);
        } catch (e) { reject(e); }
      });
    });

    req.on('error', e => { clearTimeout(to); reject(e); });
    req.write(data);
    req.end();
  });
}

async function generateSimple(excerpts, query, key) {
  const https = require('https');
  
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, 15000);
    
    const data = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Summarize biblical teaching in 3-4 paragraphs.' },
        { role: 'user', content: `Summarize Pastor Bob's teaching on "${query}":\n\n${excerpts}` }
      ],
      temperature: 0.7,
      max_tokens: 700
    });

    const opts = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        clearTimeout(to);
        try {
          const r = JSON.parse(body);
          resolve(r.choices?.[0]?.message?.content || 'Summary unavailable');
        } catch (e) { reject(e); }
      });
    });

    req.on('error', e => { clearTimeout(to); reject(e); });
    req.write(data);
    req.end();
  });
}

function extractDate(title) {
  const m = title.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : '';
}

function getDateLong(title) {
  const m = title.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return '';
  const d = new Date(m[3], m[1] - 1, m[2]);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
