// RAG Search System for Pastor Bob's Sermons

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
  'to', 'was', 'will', 'with', 'what', 'when', 'where', 'who', 'why',
  'does', 'pastor', 'bob', 'teach', 'about', 'tell', 'me'
]);

const BOOK_NAMES = {
  'genesis': 'Genesis', 'gen': 'Genesis',
  'exodus': 'Exodus', 'exo': 'Exodus', 'ex': 'Exodus',
  'leviticus': 'Leviticus', 'lev': 'Leviticus',
  'numbers': 'Numbers', 'num': 'Numbers',
  'deuteronomy': 'Deuteronomy', 'deut': 'Deuteronomy', 'deu': 'Deuteronomy',
  'joshua': 'Joshua', 'josh': 'Joshua', 'jos': 'Joshua',
  'judges': 'Judges', 'judg': 'Judges', 'jdg': 'Judges',
  'ruth': 'Ruth',
  '1samuel': '1 Samuel', '1sam': '1 Samuel', '1sa': '1 Samuel',
  '2samuel': '2 Samuel', '2sam': '2 Samuel', '2sa': '2 Samuel',
  '1kings': '1 Kings', '1ki': '1 Kings',
  '2kings': '2 Kings', '2ki': '2 Kings',
  'psalms': 'Psalms', 'psalm': 'Psalms', 'ps': 'Psalms', 'psa': 'Psalms',
  'proverbs': 'Proverbs', 'prov': 'Proverbs', 'pro': 'Proverbs',
  'ecclesiastes': 'Ecclesiastes', 'eccl': 'Ecclesiastes', 'ecc': 'Ecclesiastes',
  'isaiah': 'Isaiah', 'isa': 'Isaiah',
  'jeremiah': 'Jeremiah', 'jer': 'Jeremiah',
  'ezekiel': 'Ezekiel', 'ezek': 'Ezekiel', 'eze': 'Ezekiel',
  'daniel': 'Daniel', 'dan': 'Daniel',
  'matthew': 'Matthew', 'matt': 'Matthew', 'mat': 'Matthew', 'mt': 'Matthew',
  'mark': 'Mark', 'mar': 'Mark', 'mk': 'Mark', 'mr': 'Mark',
  'luke': 'Luke', 'luk': 'Luke', 'lk': 'Luke',
  'john': 'John', 'joh': 'John', 'jn': 'John',
  'acts': 'Acts', 'act': 'Acts',
  'romans': 'Romans', 'rom': 'Romans', 'ro': 'Romans',
  '1corinthians': '1 Corinthians', '1cor': '1 Corinthians', '1co': '1 Corinthians',
  '2corinthians': '2 Corinthians', '2cor': '2 Corinthians', '2co': '2 Corinthians',
  'galatians': 'Galatians', 'gal': 'Galatians', 'ga': 'Galatians',
  'ephesians': 'Ephesians', 'eph': 'Ephesians',
  'philippians': 'Philippians', 'phil': 'Philippians', 'php': 'Philippians',
  'colossians': 'Colossians', 'col': 'Colossians',
  '1thessalonians': '1 Thessalonians', '1thess': '1 Thessalonians', '1th': '1 Thessalonians',
  '2thessalonians': '2 Thessalonians', '2thess': '2 Thessalonians', '2th': '2 Thessalonians',
  '1timothy': '1 Timothy', '1tim': '1 Timothy', '1ti': '1 Timothy',
  '2timothy': '2 Timothy', '2tim': '2 Timothy', '2ti': '2 Timothy',
  'titus': 'Titus', 'tit': 'Titus',
  'hebrews': 'Hebrews', 'heb': 'Hebrews',
  'james': 'James', 'jas': 'James', 'jam': 'James',
  '1peter': '1 Peter', '1pet': '1 Peter', '1pe': '1 Peter',
  '2peter': '2 Peter', '2pet': '2 Peter', '2pe': '2 Peter',
  '1john': '1 John', '1jn': '1 John',
  '2john': '2 John', '2jn': '2 John',
  '3john': '3 John', '3jn': '3 John',
  'jude': 'Jude', 'jud': 'Jude',
  'revelation': 'Revelation', 'rev': 'Revelation', 're': 'Revelation'
};

function detectScripture(query) {
  const pattern = /^(\d?\s*[a-z]+)\s*(\d+)(?::(\d+)(?:-(\d+))?)?$/i;
  const match = query.trim().match(pattern);
  
  if (!match) return null;
  
  const [_, bookInput, chapter, verseStart, verseEnd] = match;
  const bookKey = bookInput.toLowerCase().replace(/\s+/g, '');
  const bookName = BOOK_NAMES[bookKey];
  
  if (!bookName) return null;
  
  let reference = `${bookName} ${chapter}`;
  if (verseStart) {
    reference += `:${verseStart}`;
    if (verseEnd) reference += `-${verseEnd}`;
  }
  
  return {
    book: bookName,
    chapter: parseInt(chapter),
    verseStart: verseStart ? parseInt(verseStart) : null,
    verseEnd: verseEnd ? parseInt(verseEnd) : null,
    display: reference,
    searchTerms: [bookName.toLowerCase(), chapter]
  };
}

function extractKeywords(query) {
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !STOP_WORDS.has(word));
}

function extractTimestampedSegments(sermon, maxSegments = 6) {
  if (!sermon.transcript || !sermon.url) return [];
  
  const segments = [];
  const regex = /\[(\d+):(\d+):(\d+)\]([\s\S]{400,600}?)(?=\[|$)/g;
  let match;
  
  while ((match = regex.exec(sermon.transcript)) && segments.length < maxSegments) {
    const [_, hours, mins, secs, text] = match;
    const totalSeconds = parseInt(hours) * 3600 + parseInt(mins) * 60 + parseInt(secs);
    
    segments.push({
      text: text.trim(),
      timestamp: `${hours}:${mins}:${secs}`,
      seconds: totalSeconds,
      url: `${sermon.url}&t=${totalSeconds}s`,
      sermonTitle: sermon.title,
      date: extractDate(sermon.title)
    });
  }
  
  return segments;
}

function searchSermons(sermons, query) {
  const scripture = detectScripture(query);
  
  if (scripture) {
    // Scripture search - check BOTH title and transcript
    const matches = sermons.filter(s => {
      if (!s) return false;
      const title = (s.title || '').toLowerCase();
      const transcript = (s.transcript || '').toLowerCase();
      const searchText = title + ' ' + transcript;
      
      // Book name and chapter must both appear
      return scripture.searchTerms.every(term => searchText.includes(term));
    });
    
    return {
      type: 'scripture',
      scripture,
      sermons: matches.slice(0, 5),
      segments: matches.flatMap(s => extractTimestampedSegments(s, 6)).slice(0, 15)
    };
  }
  
  // Keyword search
  const keywords = extractKeywords(query);
  if (keywords.length === 0) {
    return { type: 'keyword', keywords: [], sermons: [], segments: [] };
  }
  
  const threshold = Math.max(1, Math.floor(keywords.length * 0.4));
  
  const scored = sermons.map(s => {
    if (!s) return null;
    
    const text = `${s.title || ''} ${s.transcript || ''}`.toLowerCase();
    const matchCount = keywords.filter(kw => text.includes(kw)).length;
    
    if (matchCount < threshold) return null;
    
    return {
      sermon: s,
      score: matchCount / keywords.length
    };
  }).filter(Boolean);
  
  scored.sort((a, b) => b.score - a.score);
  
  const topSermons = scored.slice(0, 5).map(s => s.sermon);
  const segments = topSermons.flatMap(s => extractTimestampedSegments(s, 6)).slice(0, 15);
  
  return {
    type: 'keyword',
    keywords,
    sermons: topSermons,
    segments
  };
}

function extractDate(title) {
  const match = title.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return '';
  const [_, month, day, year] = match;
  return `${new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
}

module.exports = {
  detectScripture,
  extractKeywords,
  searchSermons,
  extractDate
};
