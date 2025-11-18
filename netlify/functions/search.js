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
    return { book: match[1].trim(), chapter: match[2], verse: match[3], found: true };
  }
  return { found: false };
}

function isTeachingQuestion(query) {
  const patterns = [/what does.*teach/i, /what is.*about/i, /explain.*verse/i, /meaning of/i, /interpretation of/i];
  return patterns.some(p => p.test(query));
}

function isRealYouTubeId(id) {
  // VibeCODE approach: Check if it's a standard 11-character YouTube ID
  if (!id) return false;
  if (id.length !== 11) return false;
  if (id.startsWith('transcript-')) return false;
  if (id.startsWith('pastor-bob-')) return false;
  if (id.startsWith('audio_')) return false;
  if (/^\d{8}-\d{2}-/.test(id)) return false; // Date patterns
  return /^[A-Za-z0-9_-]{11}$/.test(id);
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
    
    // Filter to only sermons with real YouTube IDs
    const clickableSermons = sermons.filter(s => s && s.transcript && s.url && isRealYouTubeId(s.id));
    console.log(`${clickableSermons.length} sermons have real YouTube IDs`);
    
    const scoredResults = clickableSermons.map(s => {
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
    
    let analysis = `Found ${scoredResults.length} sermons with clickable citations.`;
    const KEY = process.env.opeaikey || process.env.OPENAI_API_KEY;
    
    if (KEY && scoredResults.length > 0) {
      try {
        // Extract timestamped segments (VibeCODE approach)
        const segments = extractTimestampedSegments(scoredResults.slice(0, 5));
        
        if (segments.length >= 3) {
          console
