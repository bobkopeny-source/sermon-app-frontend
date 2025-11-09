const { searchSermons } = require('./sermon-rag');
const { generateWithCitations } = require('./grok-citations');

exports.handler = async (event, context) => {
  try {
    const { query } = JSON.parse(event.body || '{}');
    if (!query) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Query required' })
      };
    }
    
    const sermons = require('../../PASTOR_BOB_COMPLETE_2072.json');
    const GROK_API_KEY = process.env.GROK_API_KEY;
    
    // Use RAG search
    const searchResult = searchSermons(sermons, query);
    
    let grokAnalysis = 'Analyzing Pastor Bob\'s teaching...';
    
    if (GROK_API_KEY && searchResult.segments.length > 0) {
      try {
        grokAnalysis = await generateWithCitations(searchResult, query, GROK_API_KEY);
      } catch (error) {
        console.error('Grok error:', error);
        grokAnalysis = searchResult.type === 'scripture' && searchResult.scripture
          ? `${searchResult.scripture.display} - See the sermons below for Pastor Bob's teaching on this passage.`
          : 'See the sermons below for Pastor Bob\'s teaching on this topic.';
      }
    } else if (searchResult.sermons.length === 0) {
      grokAnalysis = 'No sermons found matching your search. Try different keywords or a Bible reference.';
    }
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grokSynthesis: grokAnalysis,
        sermons: searchResult.sermons.map(s => ({
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
        totalResults: searchResult.sermons.length,
        searchType: searchResult.type,
        segmentsFound: searchResult.segments.length
      })
    };
  } catch (error) {
    console.error('Search error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

function extractDate(title) {
  const match = title.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return '';
  const [_, month, day, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}
