exports.handler = async (event, context) => {
  try {
    const { query } = JSON.parse(event.body || '{}');
    if (!query) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Query required' }) };
    }
    
    const sermons = require('../../PASTOR_BOB_COMPLETE_2072.json');
    const queryLower = query.toLowerCase();
    
    // Search with more results for better context
    const results = sermons.filter(s => 
      s && (s.title?.toLowerCase().includes(queryLower) || 
            s.transcript?.toLowerCase().includes(queryLower))
    ).slice(0, 15);
    
    let grokAnalysis = 'Analyzing Pastor Bob\'s teaching...';
    const GROK_API_KEY = process.env.GROK_API_KEY;
    
    if (GROK_API_KEY && results.length > 0) {
      try {
        const segments = extractTimestampedSegments(results);
        if (segments.length > 0) {
          grokAnalysis = await generatePastorsAIStyle(segments, query, GROK_API_KEY);
        } else {
          grokAnalysis = `Pastor Bob has ${results.length} sermon${results.length > 1 ? 's' : ''} on this topic. See the videos below.`;
        }
      } catch (error) {
        console.error('Grok error:', error);
        grokAnalysis = `Found ${results.length} relevant sermons. See the videos below for Pastor Bob's teaching on "${query}".`;
      }
    } else {
      grokAnalysis = results.length > 0 
        ? `Found ${results.length} sermons on this topic.`
        : 'No sermons found. Try different keywords.';
    }
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grokSynthesis: grokAnalysis,
        sermons: results.slice(0, 10).map(s => ({
          id: s.id,
          title: s.title,
          url: s.url,
          word_count: s.word_count,
          youtubeVideo: s.url ? {
            youtubeUrl: s.url,
            date: extractDate(s.title),
            scripture: s.title.split('|')[0]?.trim() || ''
          } : null
        })),
        totalResults: results.length
      })
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

function extractTimestampedSegments(sermons) {
  const segments = [];
  
  for (const sermon of sermons) {
    if (!sermon.transcript || !sermon.url) continue;
    
    const regex = /\[(\d+):(\d+):(\d+)\]([\s\S]{300,700}?)(?=\[|$)/g;
    let match;
    let count = 0;
    
    while ((match = regex.exec(sermon.transcript)) && count < 3) {
      const [_, hours, mins, secs, text] = match;
      const timestamp = `${mins}:${secs}`;
      const totalSecs = parseInt(hours) * 3600 + parseInt(mins) * 60 + parseInt(secs);
      const date = extractDateLong(sermon.title);
      
      segments.push({
        text: text.trim(),
        timestamp,
        date,
        url: `${sermon.url}&t=${totalSecs}s`,
        citation: `[${timestamp} from ${date}]`
      });
      count++;
    }
    
    if (segments.length >= 12) break;
  }
  
  return segments.slice(0, 12);
}

async function generatePastorsAIStyle(segments, query, apiKey) {
  const https = require('https');
  
  const context = segments.map((seg, i) => 
    `[SEGMENT ${i + 1}] ${seg.citation}\n${seg.text}`
  ).join('\n\n---\n\n');
  
  const prompt = `You are synthesizing Pastor Bob Kopeny's teaching on "${query}" from Calvary Chapel East Anaheim.

Write 3-4 detailed paragraphs (like Pastors.AI format) that:
1. First explain what the Bible/topic teaches
2. Then integrate Pastor Bob's specific teaching
3. Include inline timestamp citations in this EXACT format: ([MM:SS from Month DD, YYYY])
4. Add 2-3 citations PER paragraph
5. End with a summary that includes citations

CRITICAL: Use the actual timestamps from the segments below. Format must be: ([52:59 from November 03, 2025])

SERMON SEGMENTS:
${context}

Write 3-4 detailed paragraphs with frequent inline citations about "${query}":`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      req.destroy();
      resolve(`Pastor Bob has extensive teaching on "${query}". See the sermon videos below for his full exposition of this topic.`);
    }, 25000); // 25 seconds - give Grok more time
    
    const data = JSON.stringify({
      messages: [{
        role: 'system',
        content: 'You write detailed theological explanations with inline timestamp citations like Pastors.AI. Always use format: ([MM:SS from Month DD, YYYY])'
      }, {
        role: 'user',
        content: prompt
      }],
      model: 'grok-3',
      temperature: 0.7,
      max_tokens: 1800
    });

    const options = {
      hostname: 'api.x.ai',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(body);
          if (response.choices?.[0]?.message?.content) {
            const text = response.choices[0].message.content;
            const withLinks = convertToClickableLinks(text, segments);
            resolve(withLinks);
          } else {
            resolve(`Pastor Bob addresses "${query}" in multiple sermons. See the videos below.`);
          }
        } catch (e) {
          resolve(`See the sermon videos below for Pastor Bob's teaching on "${query}".`);
        }
      });
    });

    req.on('error', () => {
      clearTimeout(timeout);
      resolve(`Pastor Bob has teaching on "${query}". See the videos below.`);
    });
    
    req.write(data);
    req.end();
  });
}

function convertToClickableLinks(text, segments) {
  // Match citations like ([52:59 from November 03, 2025])
  const regex = /\(\[(\d{1,2}:\d{2})\s+from\s+([^\]]+)\]\)/g;
  
  return text.replace(regex, (match, timestamp, dateStr) => {
    const segment = segments.find(s => 
      s.timestamp === timestamp || s.date.includes(dateStr.trim())
    );
    
    if (segment) {
      return `<a href="${segment.url}" target="_blank" class="cite-link" title="Watch at ${timestamp}">([${timestamp} from ${dateStr}])</a>`;
    }
    return match;
  });
}

function extractDate(title) {
  const m = title.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : '';
}

function extractDateLong(title) {
  const m = title.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return '';
  const [_, month, day, year] = m;
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
