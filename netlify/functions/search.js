#!/usr/bin/env python3
"""
Pastor Bob Sermon Search App - WITH CLICKABLE TIMESTAMPS
Searches 716 sermons and provides clickable YouTube timestamp links
"""

from flask import Flask, request, jsonify, render_template_string
from flask_cors import CORS
import json
import gzip
import os
import re

app = Flask(__name__)
CORS(app)

print("Loading sermon database with timestamps...")
SERMONS = []

# Try multiple possible filenames
possible_files = [
    'PASTOR_BOB_COMPLETE_716_TIMESTAMPS.json.gz',
    'PASTOR_BOB_COMPLETE_716_TIMESTAMPS.json',
    'PASTOR_BOB_SERMONS_COMPLETE_CLEAN.json.gz',
    'PASTOR_BOB_SERMONS_COMPLETE_CLEAN.json',
]

for filename in possible_files:
    if os.path.exists(filename):
        print(f"Found: {filename}")
        try:
            if filename.endswith('.gz'):
                with gzip.open(filename, 'rt', encoding='utf-8') as f:
                    SERMONS = json.load(f)
            else:
                with open(filename, 'r', encoding='utf-8') as f:
                    SERMONS = json.load(f)
            print(f"✅ Loaded {len(SERMONS)} sermons")
            break
        except Exception as e:
            print(f"Error loading {filename}: {e}")
            continue

if not SERMONS:
    print("❌ ERROR: Sermon database file not found!")

def extract_search_terms(query):
    """Extract meaningful search terms from natural language questions"""
    query_clean = re.sub(r'[^\w\s]', ' ', query.lower())
    
    noise_words = [
        'what', 'does', 'did', 'do', 'is', 'are', 'was', 'were',
        'pastor', 'bob', 'teach', 'about', 'say', 'think', 'believe',
        'tell', 'talk', 'discuss', 'mention', 'explain', 'the', 'a', 'an',
        'how', 'why', 'when', 'where', 'who', 'which', 'can', 'could',
        'should', 'would', 'will', 'me', 'us', 'you', 'his', 'her', 'their'
    ]
    
    words = [w for w in query_clean.split() if w not in noise_words and len(w) >= 4]
    
    # Basic stemming
    stemmed = []
    for word in words:
        if word.endswith('ing') and len(word) > 6:
            stemmed.append(word[:-3])
        elif word.endswith('ed') and len(word) > 5:
            stemmed.append(word[:-2])
        elif word.endswith('es') and len(word) > 5:
            stemmed.append(word[:-2])
        elif word.endswith('s') and len(word) > 4:
            stemmed.append(word[:-1])
        else:
            stemmed.append(word)
        
        if word not in stemmed:
            stemmed.append(word)
    
    return list(set(stemmed))

def find_relevant_timestamp_segments(sermon, search_terms, max_segments=3):
    """
    Find the most relevant timestamped segments that contain search terms
    """
    timestamps = sermon.get('timestamps', [])
    
    if not timestamps:
        # Fallback to plain text if no timestamps
        return []
    
    scored_segments = []
    
    for segment in timestamps:
        text = segment.get('text', '').lower()
        score = 0
        
        # Score each segment
        for term in search_terms:
            if term in text:
                score += text.count(term) * 10
        
        if score > 0:
            scored_segments.append({
                'timestamp': segment.get('time', '0:00'),
                'seconds': segment.get('seconds', 0),
                'text': segment.get('text', ''),
                'score': score
            })
    
    # Sort by score and get top segments
    scored_segments.sort(key=lambda x: x['score'], reverse=True)
    
    # Get top segments, ensuring they're spread out
    selected = []
    last_seconds = -999
    
    for seg in scored_segments:
        # Only include if at least 60 seconds from last segment
        if seg['seconds'] - last_seconds > 60 or len(selected) == 0:
            selected.append(seg)
            last_seconds = seg['seconds']
            
            if len(selected) >= max_segments:
                break
    
    # Sort selected by time
    selected.sort(key=lambda x: x['seconds'])
    
    return selected

def search_sermons_with_timestamps(query, max_results=10):
    """Enhanced search with timestamps"""
    search_terms = extract_search_terms(query)
    
    if not search_terms:
        search_terms = [w for w in query.lower().split() if len(w) >= 4]
    
    results = []
    
    for sermon in SERMONS:
        transcript = sermon.get('transcript', '').lower()
        score = 0
        
        # Calculate relevance
        for term in search_terms:
            count = transcript.count(term)
            if count > 0:
                score += min(count * 3, 25)
        
        if score == 0:
            continue
        
        # Find relevant timestamped segments
        segments = find_relevant_timestamp_segments(sermon, search_terms, max_segments=3)
        
        # Only include if we found valid segments
        if segments and len(segments) > 0:
            results.append({
                'video_id': sermon.get('video_id', ''),
                'url': sermon.get('url', ''),
                'word_count': sermon.get('word_count', 0),
                'segments': segments,
                'score': score
            })
    
    # Sort by relevance
    results.sort(key=lambda x: x['score'], reverse=True)
    
    return results[:max_results]

@app.route('/')
def home():
    html = '''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ask Pastor Bob - Sermon Search with Timestamps</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container { max-width: 1000px; margin: 0 auto; }
        
        .header {
            text-align: center;
            color: white;
            margin-bottom: 40px;
            padding-top: 40px;
        }
        
        .header h1 {
            font-size: 3em;
            margin-bottom: 10px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        
        .header p {
            font-size: 1.2em;
            opacity: 0.9;
        }
        
        .search-box {
            background: white;
            border-radius: 50px;
            padding: 10px 30px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            display: flex;
            margin-bottom: 40px;
        }
        
        .search-box input {
            flex: 1;
            border: none;
            outline: none;
            font-size: 1.1em;
            padding: 15px;
        }
        
        .search-box button {
            background: #667eea;
            color: white;
            border: none;
            padding: 15px 40px;
            border-radius: 30px;
            font-size: 1em;
            cursor: pointer;
            font-weight: 600;
            transition: background 0.3s;
        }
        
        .search-box button:hover { background: #5568d3; }
        
        .loading {
            text-align: center;
            color: white;
            font-size: 1.2em;
            display: none;
            margin: 20px 0;
        }
        
        .results { display: none; }
        
        .result-count {
            color: white;
            font-size: 1.1em;
            margin-bottom: 20px;
            text-align: center;
        }
        
        .sermon-card {
            background: white;
            border-radius: 15px;
            padding: 25px;
            margin-bottom: 20px;
            box-shadow: 0 5px 20px rgba(0,0,0,0.1);
        }
        
        .timestamp-segment {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 10px;
            margin: 10px 0;
            border-left: 4px solid #667eea;
        }
        
        .timestamp-link {
            display: inline-block;
            background: #667eea;
            color: white;
            padding: 5px 15px;
            border-radius: 20px;
            text-decoration: none;
            font-weight: 600;
            margin-bottom: 10px;
            font-size: 0.9em;
            transition: background 0.3s;
        }
        
        .timestamp-link:hover {
            background: #5568d3;
            transform: scale(1.05);
        }
        
        .segment-text {
            color: #333;
            line-height: 1.6;
            margin-top: 5px;
        }
        
        .segment-separator {
            margin: 15px 0;
            color: #999;
            text-align: center;
        }
        
        .watch-full {
            display: inline-block;
            background: #ff0000;
            color: white;
            padding: 12px 30px;
            border-radius: 25px;
            text-decoration: none;
            font-weight: 600;
            margin-top: 10px;
        }
        
        .watch-full:hover { background: #cc0000; }
        
        .stats {
            background: rgba(255,255,255,0.2);
            border-radius: 15px;
            padding: 20px;
            color: white;
            text-align: center;
            margin-bottom: 30px;
        }
        
        .stats-number {
            font-size: 2.5em;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎤 Ask Pastor Bob</h1>
            <p>Search 716 sermons with clickable timestamps</p>
        </div>
        
        <div class="stats">
            <div class="stats-number">716</div>
            <div>Complete Sermons with Clickable Timestamps</div>
        </div>
        
        <div class="search-box">
            <input 
                type="text" 
                id="searchInput" 
                placeholder="Ask anything... (e.g., 'What does Pastor Bob teach about witnessing?')"
                onkeypress="if(event.key === 'Enter') searchSermons()"
            />
            <button onclick="searchSermons()">Search</button>
        </div>
        
        <div class="loading" id="loading">
            🔍 Searching 716 sermons...
        </div>
        
        <div class="results" id="results">
            <div class="result-count" id="resultCount"></div>
            <div id="resultsList"></div>
        </div>
    </div>
    
    <script>
        async function searchSermons() {
            const query = document.getElementById('searchInput').value.trim();
            
            if (!query) {
                alert('Please enter a search term');
                return;
            }
            
            document.getElementById('loading').style.display = 'block';
            document.getElementById('results').style.display = 'none';
            
            try {
                const response = await fetch(`/api/search/timestamps?q=${encodeURIComponent(query)}`);
                
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                const data = await response.json();
                console.log('API Response:', data); // Debug logging
                
                document.getElementById('loading').style.display = 'none';
                
                if (!data) {
                    console.error('No data received from API');
                    document.getElementById('results').innerHTML = '<p style="color:white;text-align:center">Error: No data received. Please try again.</p>';
                    document.getElementById('results').style.display = 'block';
                    return;
                }
                
                if (data.results && Array.isArray(data.results) && data.results.length > 0) {
                    console.log('Displaying', data.results.length, 'results');
                    displayResults(data.results, query);
                } else {
                    console.log('No results found or invalid results array');
                    document.getElementById('results').innerHTML = '<p style="color:white;text-align:center">No sermons found. Try different keywords.</p>';
                    document.getElementById('results').style.display = 'block';
                }
            } catch (error) {
                console.error('Search error:', error);
                document.getElementById('loading').style.display = 'none';
                document.getElementById('results').innerHTML = '<p style="color:white;text-align:center">Error: ' + error.message + '</p>';
                document.getElementById('results').style.display = 'block';
            }
        }
        
        function displayResults(results, query) {
            console.log('displayResults called with:', results);
            
            if (!results || !Array.isArray(results)) {
                console.error('Results is not an array:', results);
                document.getElementById('results').innerHTML = '<p style="color:white;text-align:center">Error displaying results. Please try again.</p>';
                document.getElementById('results').style.display = 'block';
                return;
            }
            
            const resultCount = document.getElementById('resultCount');
            const resultsList = document.getElementById('resultsList');
            
            // Filter out results without segments
            const validResults = results.filter(sermon => {
                const hasSegments = sermon && sermon.segments && Array.isArray(sermon.segments) && sermon.segments.length > 0;
                if (!hasSegments) {
                    console.warn('Sermon missing valid segments:', sermon);
                }
                return hasSegments;
            });
            
            console.log('Valid results after filtering:', validResults.length);
            
            if (validResults.length === 0) {
                document.getElementById('results').innerHTML = '<p style="color:white;text-align:center">No sermons found with timestamps. Try different keywords.</p>';
                document.getElementById('results').style.display = 'block';
                return;
            }
            
            resultCount.textContent = `Found ${validResults.length} sermons about "${query}"`;
            
            try {
                resultsList.innerHTML = validResults.map(sermon => `
                    <div class="sermon-card">
                        ${sermon.segments.map((seg, idx) => `
                            <div class="timestamp-segment">
                                <a href="${sermon.url}&t=${seg.seconds}s" target="_blank" class="timestamp-link">
                                    ⏱️ Jump to ${seg.timestamp}
                                </a>
                                <div class="segment-text">"${seg.text}"</div>
                            </div>
                            ${idx < sermon.segments.length - 1 ? '<div class="segment-separator">• • •</div>' : ''}
                        `).join('')}
                        <a href="${sermon.url}" target="_blank" class="watch-full">▶️ Watch Full Sermon</a>
                    </div>
                `).join('');
                
                document.getElementById('results').style.display = 'block';
            } catch (error) {
                console.error('Error rendering results:', error);
                document.getElementById('results').innerHTML = '<p style="color:white;text-align:center">Error rendering results: ' + error.message + '</p>';
                document.getElementById('results').style.display = 'block';
            }
        }
    </script>
</body>
</html>
'''
    return render_template_string(html)

@app.route('/api/search/timestamps')
def api_search_timestamps():
    """API endpoint for timestamped search"""
    query = request.args.get('q', '')
    max_results = int(request.args.get('max', 10))
    
    if not query:
        return jsonify({'error': 'No query provided'}), 400
    
    results = search_sermons_with_timestamps(query, max_results)
    
    return jsonify({
        'query': query,
        'total_sermons': len(SERMONS),
        'results_count': len(results),
        'results': results
    })

@app.route('/api/stats')
def api_stats():
    """Get statistics"""
    total_words = sum(s.get('word_count', 0) for s in SERMONS)
    total_timestamps = sum(len(s.get('timestamps', [])) for s in SERMONS)
    
    return jsonify({
        'total_sermons': len(SERMONS),
        'total_words': total_words,
        'total_timestamps': total_timestamps
    })

if __name__ == '__main__':
    if not SERMONS:
        print("\n❌ ERROR: No sermons loaded!")
        exit(1)
    
    print("\n✅ Sermon Search App with Timestamps Ready!")
    print(f"📚 Loaded {len(SERMONS)} sermons")
    print("\n🌐 Starting server...")
    
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=False, host='0.0.0.0', port=port)
