exports.handler = async (event, context) => {
  try {
    const { query } = JSON.parse(event.body || '{}');
    if (!query) return { statusCode: 400, body: JSON.stringify({ error: 'Query required' }) };
    
    const sermons = require('../../PASTOR_BOB_COMPLETE_2072.json');
    const GROK_API_KEY = process.env.GROK_API_KEY;
    
    // Detect if it's a Bible reference
    const bibleRef = parseBibleReference(query);
    let results, grokAnalysis;
    
    if (bibleRef) {
      // Bible passage search - find sermons on this passage
      results = searchByScripture(sermons, bibleRef);
      
      if (GROK_API_KEY && results.length > 0) {
        try {
          const excerpts = results.filter(s => s.transcript).slice(0, 3)
            .map(s => s.transcript.substring(0, 800)).join('\n\n');
          grokAnalysis = await synthesizeBiblePassage(bibleRef, excerpts, GROK_API_KEY);
        } catch (error) {
          console.error('Grok error:', error);
          grokAnalysis = `${bibleRef.display} is a significant passage that Pastor Bob has taught on. See the sermons below for his exposition.`;
        }
      } else {
        grokAnalysis = `${bibleRef.display} - Pastor Bob has ${results.length} sermon${results.length !== 1 ? 's' : ''} on this passage.`;
      }
    } else {
      // Regular topic search
      results = sermons.filter(s => 
        s && (s.title?.toLowerCase().includes(query.toLowerCase()) || 
              s.transcript?.toLowerCase().includes(query.toLowerCase()))
      ).slice(0, 10);
      
      if (GROK_API_KEY && results.length > 0) {
        try {
          const excerpts = results.filter(s => s.transcript).slice(0, 2)
            .map(s => s.transcript.substring(0, 600)).join('\n\n');
          grokAnalysis = await synthesizeTopic(query, excerpts, GROK_API_KEY);
        } catch (error) {
          grokAnalysis = 'See the sermons below for Pastor Bob\'s teaching on this topic.';
        }
      } else {
        grokAnalysis = results.length > 0 ? 
          'See the sermons below for relevant teaching.' : 
          'No sermons found. Try different keywords.';
      }
    }
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grokSynthesis: grokAnalysis,
        sermons: results.map(s => ({
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
        totalResults: results.length,
        searchType: bibleRef ? 'scripture' : 'topic'
      })
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

function parseBibleReference(query) {
  // Match patterns like "Acts 6:1", "Romans 9", "1 Corinthians 13:4-7", etc.
  const pattern = /^([1-3]?\s*[a-z]+)\s*(\d+)(?::(\d+)(?:-(\d+))?)?$/i;
  const match = query.trim().match(pattern);
  
  if (!match) return null;
  
  const [_, book, chapter, verseStart, verseEnd] = match;
  const bookMap = {
    'gen': 'Genesis', 'exo': 'Exodus', 'lev': 'Leviticus', 'num': 'Numbers', 'deut': 'Deuteronomy',
    'josh': 'Joshua', 'judg': 'Judges', 'ruth': 'Ruth', '1sam': '1 Samuel', '2sam': '2 Samuel',
    '1kings': '1 Kings', '2kings': '2 Kings', 'ps': 'Psalms', 'prov': 'Proverbs', 'eccl': 'Ecclesiastes',
    'song': 'Song of Solomon', 'isa': 'Isaiah', 'jer': 'Jeremiah', 'lam': 'Lamentations', 'ezek': 'Ezekiel',
    'dan': 'Daniel', 'hos': 'Hosea', 'joel': 'Joel', 'amos': 'Amos', 'obad': 'Obadiah', 'jonah': 'Jonah',
    'mic': 'Micah', 'nah': 'Nahum', 'hab': 'Habakkuk', 'zeph': 'Zephaniah', 'hag': 'Haggai',
    'zech': 'Zechariah', 'mal': 'Malachi', 'matt': 'Matthew', 'mark': 'Mark', 'luke': 'Luke',
    'john': 'John', 'acts': 'Acts', 'rom': 'Romans', '1cor': '1 Corinthians', '2cor': '2 Corinthians',
    'gal': 'Galatians', 'eph': 'Ephesians', 'phil': 'Philippians', 'col': 'Colossians',
    '1thess': '1 Thessalonians', '2thess': '2 Thessalonians', '1tim': '1 Timothy', '2tim': '2 Timothy',
    'titus': 'Titus', 'philem': 'Philemon', 'heb': 'Hebrews', 'james': 'James', '1pet': '1 Peter',
    '2pet': '2 Peter', '1john': '1 John', '2john': '2 John', '3john': '3 John', 'jude': 'Jude', 'rev': 'Revelation'
  };
  
  const bookKey = book.trim().toLowerCase().replace(/\s+/g, '');
  const fullBook = bookMap[bookKey] || book.trim();
  
  let display = `${fullBook} ${chapter}`;
  if (verseStart) {
    display += `:${verseStart}`;
    if (verseEnd) display += `-${verseEnd}`;
  }
  
  return {
    book: fullBook,
    bookKey,
    chapter,
    verseStart,
    verseEnd,
    display
  };
}

function searchByScripture(sermons, ref) {
  return sermons.filter(s => {
    if (!s) return false;
    const title = (s.title || '').toLowerCase();
    const bookMatch = title.includes(ref.book.toLowerCase()) || title.includes(ref.bookKey);
    const chapterMatch = title.includes(ref.chapter);
    return bookMatch && chapterMatch;
  }).slice(0, 10);
}

async function synthesizeBiblePassage(ref, excerpts, apiKey) {
  const https = require('https');
  
  const prompt = `You are explaining the Bible passage ${ref.display} based on Pastor Bob Kopeny's teaching from Calvary Chapel East Anaheim.

Write 4 paragraphs that:
1. FIRST: Explain what ${ref.display} is about (the biblical context and main message)
2. THEN: Share how Pastor Bob teaches and applies this passage
3. Include key theological points and practical applications
4. End with Pastor Bob's pastoral emphasis

EXCERPTS FROM PASTOR BOB'S SERMONS:
${excerpts}

Write 4 detailed paragraphs about ${ref.display}:`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, 12000);
    
    const data = JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      model: 'grok-3',
      temperature: 0.7,
      max_tokens: 1000
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
            resolve(response.choices[0].message.content);
          } else {
            reject(new Error('No content'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', e => { clearTimeout(timeout); reject(e); });
    req.write(data);
    req.end();
  });
}

async function synthesizeTopic(query, excerpts, apiKey) {
  const https = require('https');
  
  const prompt = `Summarize Pastor Bob's teaching on "${query}" in 3 paragraphs:\n\n${excerpts}`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, 12000);
    
    const data = JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      model: 'grok-3',
      temperature: 0.7,
      max_tokens: 800
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
            resolve(response.choices[0].message.content);
          } else {
            reject(new Error('No content'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', e => { clearTimeout(timeout); reject(e); });
    req.write(data);
    req.end();
  });
}

function extractDate(title) {
  const m = title.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : '';
}
