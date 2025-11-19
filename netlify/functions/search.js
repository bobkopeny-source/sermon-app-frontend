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

function extractBibleReference(query) {
  const match = query.match(/(\d?\s*[A-Za-z]+)\s+(\d+)(?::(\d+))?/);
  if (match) return { book: match[1].trim(), chapter: match[2], verse: match[3], found: true };
  return { found: false };
}

function isTeachingQuestion(query) {
  return /what does.*teach|what is.*about|explain.*verse|meaning of|interpretation of/i.test(query);
}

exports.handler = async (event, context) => {
  try {
    const { query } = JSON.parse(event.body || '{}');
    if (!query) return { statusCode: 400, body: JSON.stringify({ error: 'Query required' }) };
    
    const sermons = loadAllSermons();
    let queryLower = query.toLowerCase();
    const isQuestion = isTeachingQuestion(query);
    const bibleRef = extractBibleReference(query);
    
    if (bibleRef.found) {
      queryLower = `${bibleRef.book} ${bibleRef.chapter}`.toLowerCase();
    }
    
    // FIXED: Use ALL sermons with transcripts, not just ones with videos
    const allSermons = sermons.filter(s => s && s.transcript);
    
    const scoredResults = allSermons.map(s => {
      const titleLower = (s.title || '').toLowerCase();
      const transcriptLower = s.transcript.toLowerCase().replace(/\[\d+:\d+:\d+\]/g, ' ');
      let titleMatches = 0, transcriptMatches = 0;
      
      if (bibleRef.found) {
        const bookChapter = `${bibleRef.book} ${bibleRef.chapter}`.toLowerCase();
        const pattern = new RegExp(bookChapter.replace(/\s+/g, '\\s*'), 'gi');
        titleMatches = (titleLower.match(pattern) || []).length;
        transcriptMatches = (transcriptLower.match(pattern) || []).length;
      } else {
        const pattern = new RegExp(queryLower, 'g');
        titleMatches = (titleLower.match(pattern) || []).length;
        transcriptMatches = (transcriptLower.match(pattern) || []).length;
      }
      
      const score = (titleMatches * 10) + transcriptMatches;
      return { sermon: s, score, transcriptMatches };
    }).filter(r => r.score > 0).sort((a, b) => b.score - a.score);
    
    let analysis = `Found ${scoredResults.length} sermons.`;
    const KEY = process.env.opeaikey || process.env.OPENAI_API_KEY;
    
    if (KEY && scoredResults.length > 0) {
      try {
        const topForSummary = scoredResults.slice(0, 5);
        const relevantExcerpts = topForSummary.map(r => {
          const s = r.sermon;
          const transcript = s.transcript.replace(/\[\d+:\d+:\d+\]/g, ' ');
          const title = s.title || 'Untitled';
          const lowerTranscript = transcript.toLowerCase();
          const queryIndex = lowerTranscript.indexOf(queryLower);
          let excerpt;
          if (queryIndex !== -1) {
            const start = Math.max(0, queryIndex - 1200);
            const end = Math.min(transcript.length, queryIndex + 1800);
            excerpt = transcript.substring(start, end);
          } else {
            excerpt = transcript.substring(0, 3000);
          }
          return `SERMON: "${title}"\nPASTOR BOB'S WORDS:\n${excerpt}`;
        }).join('\n\n========\n\n');
        
        console.log(`Generating summary from ${topForSummary.length} sermons (isQuestion: ${isQuestion})`);
        analysis = await callOpenAI(relevantExcerpts, query, bibleRef, isQuestion, KEY);
      } catch (e) {
        console.error('OpenAI error:', e.message);
        analysis = `Pastor Bob addresses "${query}" in ${scoredResults.length} sermons. His teaching emphasizes biblical truth and practical application for daily Christian living.`;
      }
    }
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grokSynthesis: analysis, sermons: [], totalResults: scoredResults.length })
    };
  } catch (error) {
    console.error('Handler error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

async function callOpenAI(excerpts, query, bibleRef, isQuestion, key) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, 25000);
    
    let prompt;
    if (isQuestion && bibleRef.found && bibleRef.verse) {
      const verseRef = `${bibleRef.book} ${bibleRef.chapter}:${bibleRef.verse}`;
      prompt = `Answer: "${query}"\n\nFirst explain what ${verseRef} teaches, then add Pastor Bob's insights from these sources. Include 1-2 exact quotes.\n\nSOURCES:\n${excerpts}\n\nWrite:`;
    } else {
      prompt = `Summarize Pastor Bob's teaching on "${query}". Include 1-2 exact quotes and any illustrations or stories he uses.\n\nSOURCES:\n${excerpts}\n\nWrite:`;
    }
    
    const data = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: 'Summarize pastoral teaching accurately with exact quotes.' }, { role: 'user', content: prompt }],
      temperature: 0.6, max_tokens: 1400
    });
    
    const opts = { hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'Content-Length': Buffer.byteLength(data) } };
    const req = https.request(opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        clearTimeout(timeout);
        if (res.statusCode !== 200) return reject(new Error(`Status ${res.statusCode}`));
        try {
          const content = JSON.parse(body).choices?.[0]?.message?.content;
          if (content) resolve(content); else reject(new Error('No content'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', e => { clearTimeout(timeout); reject(e); });
    req.write(data);
    req.end();
  });
}
