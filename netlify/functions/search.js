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

function isRealYouTubeId(id) {
  if (!id || id.length !== 11) return false;
  if (id.startsWith('transcript-') || id.startsWith('pastor-bob-') || id.startsWith('audio_')) return false;
  if (/^\d{8}-\d{2}-/.test(id)) return false;
  return /^[A-Za-z0-9_-]{11}$/.test(id);
}

function extractTimestampedSegments(results) {
  const segments = [];
  for (const r of results) {
    const s = r.sermon;
    if (!s.transcript.match(/\[\d+:\d+:\d+\]/)) continue;
    const regex = /\[(\d+):(\d+):(\d+)\]([\s\S]{200,600}?)(?=\[|$)/g;
    let match, count = 0;
    while ((match = regex.exec(s.transcript)) && count < 3) {
      const [_, h, m, sec, text] = match;
      const totalSecs = parseInt(h)*3600 + parseInt(m)*60 + parseInt(sec);
      if (text.trim().length > 80) {
        segments.push({
          text: text.trim(),
          timestamp: `${m}:${sec}`,
          title: s.title,
          url: `${s.url}&t=${totalSecs}s`
        });
        count++;
      }
    }
    if (segments.length >= 8) break;
  }
  return segments;
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
    
    const clickableSermons = sermons.filter(s => s && s.transcript && s.url && isRealYouTubeId(s.id));
    
    const scoredResults = clickableSermons.map(s => {
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
        const segments = extractTimestampedSegments(scoredResults.slice(0, 5));
        
        if (segments.length >= 3) {
          console.log(`Using ${segments.length} timestamped segments with citations`);
          analysis = await withCitations(segments, query, bibleRef, isQuestion, KEY);
        } else {
          console.log('Not enough timestamps, using simple summary');
          const excerpts = scoredResults.slice(0, 3).map(r => {
            const transcript = r.sermon.transcript.replace(/\[\d+:\d+:\d+\]/g, ' ');
            return transcript.substring(0, 2000);
          }).join('\n\n---\n\n');
          analysis = await simpleSummary(excerpts, query, bibleRef, isQuestion, KEY);
        }
      } catch (e) {
        console.error('AI error:', e.message);
        analysis = `Pastor Bob addresses "${query}" in ${scoredResults.length} sermons.`;
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

async function withCitations(segments, query, bibleRef, isQuestion, key) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, 25000);
    
    const sources = segments.map((seg, i) => `[${i+1}] At ${seg.timestamp} from "${seg.title}":\n"${seg.text.substring(0, 300)}"`).join('\n\n');
    
    let prompt;
    if (isQuestion && bibleRef.found && bibleRef.verse) {
      const verseRef = `${bibleRef.book} ${bibleRef.chapter}:${bibleRef.verse}`;
      prompt = `Answer: "${query}"\n\nFirst explain what ${verseRef} teaches, then add Pastor Bob's insights from these sources. Cite each source as [1], [2], [3].\n\nSOURCES:\n${sources}\n\nWrite with citations:`;
    } else {
      prompt = `Summarize Pastor Bob's teaching on "${query}". Include 1-2 exact quotes and cite sources as [1], [2], [3].\n\nSOURCES:\n${sources}\n\nWrite with citations:`;
    }
    
    const data = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: 'Cite sources as [1], [2], [3]. Use different numbers.' }, { role: 'user', content: prompt }],
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
          let text = JSON.parse(body).choices?.[0]?.message?.content || '';
          segments.forEach((seg, i) => {
            const link = `<a href="${seg.url}" target="_blank" class="cite-link">([${seg.timestamp} from ${seg.title.substring(0, 40)}...])</a>`;
            text = text.replace(new RegExp(`\\[${i+1}\\]`, 'g'), link);
          });
          resolve(text);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', e => { clearTimeout(timeout); reject(e); });
    req.write(data);
    req.end();
  });
}

async function simpleSummary(excerpts, query, bibleRef, isQuestion, key) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, 20000);
    let prompt;
    if (isQuestion && bibleRef.found && bibleRef.verse) {
      const verseRef = `${bibleRef.book} ${bibleRef.chapter}:${bibleRef.verse}`;
      prompt = `Answer: "${query}"\n\nFirst explain what ${verseRef} teaches, then add Pastor Bob's insights.\n\n${excerpts}`;
    } else {
      prompt = `Summarize Pastor Bob's teaching on "${query}":\n\n${excerpts}`;
    }
    const data = JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: 'Summarize pastoral teaching.' }, { role: 'user', content: prompt }], temperature: 0.7, max_tokens: 1200 });
    const opts = { hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'Content-Length': Buffer.byteLength(data) } };
    const req = https.request(opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { clearTimeout(timeout); try { resolve(JSON.parse(body).choices?.[0]?.message?.content || 'Summary unavailable'); } catch (e) { reject(e); } });
    });
    req.on('error', e => { clearTimeout(timeout); reject(e); });
    req.write(data);
    req.end();
  });
}
