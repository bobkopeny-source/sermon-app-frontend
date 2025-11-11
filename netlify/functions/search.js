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
        const segments = extractSegments(results);
        analysis = segments.length > 5 
          ? await generateWithCitations(segments, query, KEY)
          : await generateSimple(results, query, KEY);
      } catch (e) {
        console.error('AI error:', e.message);
        analysis = `Pastor Bob has ${results.length} sermons on "${query}".
