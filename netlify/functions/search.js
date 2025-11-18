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
  if (match) {
    const book = match[1].trim();
    const chapter = match[2];
    const verse = match[3];
    return { book, chapter, verse, found: true };
  }
  return { found: false };
}

function isTeachingQuestion(query) {
  const patterns = [
    /what does.*teach/i,
    /what is.*about/i,
    /explain.*verse/i,
    /meaning of/i,
    /interpretation of/i
  ];
  return patterns.some(p => p.test(query));
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
      console.log(`Detected Bible reference: ${bibleRef.book} ${bibleRef.chapter}${bibleRef.verse ? ':' + bibleRef.verse : ''}`);
      queryLower = `${bibleRef.book} ${bibleRef.chapter}`.toLowerCase();
    }
    
    const scoredResults = sermons.filter(s => s && s.transcript).map(s => {
      const titleLower = (s.title || '').toLowerCase();
      const transcriptLower = s.transcript.toLowerCase().replace(/\[\d+:\d+:\d+\]/g, ' ');
      
      let titleMatches = 0;
      let transcriptMatches = 0;
      
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
      return { sermon: s, score: score, transcriptMatches: transcriptMatches };
    }).filter(r => r.score > 0).sort((a, b) => b.score - a.score);
    
    const topForSummary = scoredResults.slice(0, 5);
    
    let analysis = `Found ${scoredResults.length} sermons addressing "${query}".`;
    const KEY = process.env.opeaikey || process.env.OPENAI_API_KEY;
    
    if (KEY && topForSummary.length > 0) {
      try {
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
      body: JSON.stringify({
        grokSynthesis: analysis,
        sermons: [],
        totalResults: scoredResults.length
      })
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
      // Specific verse question - focus on that verse
      const verseRef = `${bibleRef.book} ${bibleRef.chapter}:${bibleRef.verse}`;
      prompt = `The user asks: "${query}"

Below are excerpts from Pastor Bob Kopeny's sermons where he teaches on ${verseRef}.

YOUR TASK: Answer the question directly. Start by explaining what ${verseRef} teaches, then provide Pastor Bob's insights.

STRUCTURE:
1. First paragraph: Directly answer "What does ${verseRef} teach?" - explain the verse content and meaning
2. Next paragraphs: Share Pastor Bob's teaching, including:
   - At least 1-2 EXACT QUOTES from Pastor Bob (his actual words in quotation marks)
   - Any illustrations, stories, or examples he uses
   - Practical applications he emphasizes

EXCERPTS FROM PASTOR BOB'S SERMONS:
${excerpts}

Write a clear answer that directly addresses the question about ${verseRef}:`;
    } else {
      // General topic or broader question
      prompt = `You are summarizing Pastor Bob Kopeny's teaching on "${query}" from Calvary Chapel East Anaheim.

CRITICAL REQUIREMENTS:
1. Include at least 1-2 EXACT QUOTES from Pastor Bob (copy his actual words verbatim in quotation marks)
2. Include any ILLUSTRATIONS, STORIES, or EXAMPLES he uses (describe them in detail)

Below are Pastor Bob's actual spoken words from his sermons. Write a 4-5 paragraph summary that includes:

- Biblical foundations and key scriptures he references
- 1-2 EXACT QUOTES from Pastor Bob (his precise words from the excerpts)
- Any ILLUSTRATIONS, STORIES, or EXAMPLES he shares (describe them)
- Practical applications he emphasizes

LOOK FOR:
- Stories about people
- Illustrations and analogies
- Examples from daily life, history, or current events
- Personal experiences Pastor Bob shares

DO NOT paraphrase quotes - use his EXACT words.

${excerpts}

Write the summary with quotes AND any illustrations/stories Pastor Bob uses:`;
    }
    
    const data = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You answer questions about Bible verses directly and include exact quotes from the pastor. When asked "what does X teach", you explain the verse content first, then add the pastor\'s insights.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.6,
      max_tokens: 1400
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
