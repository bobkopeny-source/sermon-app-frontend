// Grok AI with Inline Citations System

async function generateWithCitations(searchResult, query, apiKey) {
  const https = require('https');
  
  if (searchResult.segments.length === 0) {
    return 'No relevant sermons found for this query.';
  }
  
  // Build context with numbered segments
  const context = searchResult.segments.map((seg, i) => 
    `[${i + 1}] From ${seg.date}:\n${seg.text}`
  ).join('\n\n---\n\n');
  
  let prompt;
  
  if (searchResult.type === 'scripture' && searchResult.scripture) {
    const ref = searchResult.scripture.display;
    prompt = `You are explaining the Bible passage ${ref} based on Pastor Bob Kopeny's teaching.

Write 4 paragraphs that MUST include inline citations in this EXACT format: ([TIMESTAMP from DATE])

CRITICAL CITATION RULES:
- After EVERY claim about Pastor Bob's teaching, add: ([10:51 from October 09, 2025])
- Use the actual timestamps and dates from the segments below
- Include 3-5 citations per paragraph
- The format is MANDATORY: ([HH:MM from Month DD, YYYY])

STRUCTURE:
Paragraph 1: Quote and explain what ${ref} says biblically
Paragraph 2: How Pastor Bob teaches this passage [WITH CITATIONS]
Paragraph 3: Key illustrations and applications Pastor Bob uses [WITH CITATIONS]
Paragraph 4: Summary with Pastor Bob's emphasis [WITH CITATIONS]

SERMON SEGMENTS WITH TIMESTAMPS:
${context}

Write 4 paragraphs with inline citations:`;
  } else {
    prompt = `Synthesize Pastor Bob's teaching on "${query}" in 3-4 paragraphs.

CRITICAL: After EVERY claim, add an inline citation in this EXACT format: ([10:51 from October 09, 2025])

Use the actual timestamps and dates from the segments below. Include 3-5 citations per paragraph.

SERMON SEGMENTS:
${context}

Write 3-4 paragraphs with frequent inline citations:`;
  }
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      req.destroy();
      reject(new Error('timeout'));
    }, 20000);
    
    const data = JSON.stringify({
      messages: [{
        role: 'system',
        content: 'You MUST include inline timestamp citations in every response. Format: ([HH:MM from Month DD, YYYY])'
      }, {
        role: 'user',
        content: prompt
      }],
      model: 'grok-3',
      temperature: 0.7,
      max_tokens: 1500
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
            const withLinks = convertCitationsToLinks(text, searchResult.segments);
            resolve(withLinks);
          } else {
            reject(new Error('No content'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', e => {
      clearTimeout(timeout);
      reject(e);
    });
    
    req.write(data);
    req.end();
  });
}

function convertCitationsToLinks(text, segments) {
  // Match citations like ([10:51 from October 09, 2025])
  const citationRegex = /\(\[(\d{1,2}:\d{2}(?::\d{2})?)\s+from\s+([^\]]+)\]\)/g;
  
  return text.replace(citationRegex, (match, timestamp, dateStr) => {
    // Find matching segment
    const segment = segments.find(s => 
      s.timestamp.startsWith(timestamp) || 
      s.date.includes(dateStr.trim())
    );
    
    if (segment) {
      return `<a href="${segment.url}" target="_blank" class="timestamp-cite" title="Watch at ${segment.timestamp}">(${timestamp} from ${dateStr})</a>`;
    }
    
    return match; // Keep original if no match found
  });
}

module.exports = {
  generateWithCitations
};
