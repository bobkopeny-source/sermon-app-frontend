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
        const segments = extractTimestampedSegments(results);
        
        if (segments.length >= 2) {
          console.log(`Found ${segments.length} timestamped segments, generating with citations`);
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

function extractTimestampedSegments(sermons) {
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
      
      const timestamp = `${m}:${s}`;
      const totalSecs = parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s);
      const date = getDateLong(sermon.title);
      
      if (date) {
        segments.push({
          text: cleanText,
          timestamp: timestamp,
          date: date,
          url: `${sermon
