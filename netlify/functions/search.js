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

function extractDate(title) {
  const m = title.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : '';
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
    
    // Use ALL sermons with transcripts
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
    
    let analysis = `Found ${scoredResults.length} sermons addressing "${query}".`;
    const KEY = process.env.opeaikey || process.env.OPENAI_API_KEY;
    
    if (KEY && scoredResults.length > 0) {
      try {
        // Use top 5 sermons for AI summary
        const topForSummary = scoredResults.slice(0, 5);
        const relevantExcerpts = topForSummary.map(r => {
          const s = r.sermon;
          const transcript = s.transcript.replace(/\[\d+:\d+:\d+\]/g, ' ');
          const title = s.title || 'Untitled';
          const lowerTranscript = transcript.toLowerCase();
          const queryIndex = lowerTranscript.indexOf(queryLower);
          
          let excerpt;
          if (queryIndex !== -1) {
            const start = Math.max(0, queryIndex - 1500);
            const end = Math.min(transcript.length, queryIndex + 2500);
            excerpt = transcript.substring(start, end);
          } else {
            excerpt = transcript.substring(0, 4000);
          }
          return `From sermon "${title}":\n${excerpt}`;
        }).join('\n\n========\n\n');
        
        console.log(`Generating comprehensive summary from ${topForSummary.length} sermons`);
        analysis = await callOpenAI(relevantExcerpts, query, bibleRef, isQuestion, KEY);
      } catch (e) {
        console.error('OpenAI error:', e.message);
        analysis = `Pastor Bob addresses "${query}" in ${scoredResults.length} sermons. His teaching emphasizes biblical truth and practical application for daily Christian living.`;
      }
    }
    
    // Return top video sermons (ones with URLs)
    const videoSermons = scoredResults
      .filter(r => r.sermon.url)
      .slice(0, 8)
      .map(r => ({
        id: r.sermon.id,
        title: r.sermon.title,
        url: r.sermon.url,
        word_count: r.sermon.word_count,
        youtubeVideo: {
          youtubeUrl: r.sermon.url,
          date: extractDate(r.sermon.title),
          scripture: r.sermon.title.split('|')[0]?.trim() || r.sermon.title.substring(0, 60)
        }
      }));
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        grokSynthesis: analysis, 
        sermons: videoSermons,
        totalResults: scoredResults.length 
      })
    };
  } catch (error) {
    console.error('Handler error:', error);
    return { statusCode: 500, body: JSON.stringify({
