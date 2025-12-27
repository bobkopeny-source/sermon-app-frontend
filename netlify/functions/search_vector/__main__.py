"""
Netlify Function: Vector-based Sermon Search
Ultra-fast semantic search using Qdrant vector database
"""

import json
import os
from openai import OpenAI
from qdrant_client import QdrantClient

# Configuration
OPENAI_API_KEY = os.environ.get('opeaikey') or os.environ.get('OPENAI_API_KEY')
QDRANT_URL = os.environ.get('QDRANT_URL')
QDRANT_API_KEY = os.environ.get('QDRANT_API_KEY')
COLLECTION_NAME = "pastor_bob_sermons"
EMBEDDING_MODEL = "text-embedding-3-small"

# Initialize clients (reused across invocations)
openai_client = None
qdrant_client = None

def get_clients():
    """Initialize or retrieve cached clients"""
    global openai_client, qdrant_client
    
    if not openai_client:
        openai_client = OpenAI(api_key=OPENAI_API_KEY)
    
    if not qdrant_client:
        qdrant_client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)
    
    return openai_client, qdrant_client

def search_sermons(query, limit=4):
    """Vector search for relevant sermons"""
    openai_client, qdrant_client = get_clients()
    
    # Create query embedding
    response = openai_client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=query
    )
    query_vector = response.data[0].embedding
    
    # Search Qdrant
    results = qdrant_client.search(
        collection_name=COLLECTION_NAME,
        query_vector=query_vector,
        limit=limit,
        score_threshold=0.7  # Only return good matches
    )
    
    # Convert to sermon objects
    sermons = []
    for result in results:
        sermon = result.payload
        sermon['score'] = result.score
        sermons.append(sermon)
    
    return sermons

def extract_relevant_excerpts(sermons, query, max_length=1000):
    """Extract relevant portions from sermon transcripts"""
    excerpts = []
    
    for sermon in sermons:
        transcript = sermon.get('transcript', '')
        
        # Find query in transcript
        query_lower = query.lower()
        transcript_lower = transcript.lower()
        
        pos = transcript_lower.find(query_lower)
        if pos == -1:
            # If exact query not found, take from beginning
            pos = 0
        
        # Extract excerpt around query
        start = max(0, pos - max_length // 2)
        end = min(len(transcript), pos + max_length // 2)
        excerpt = transcript[start:end]
        
        if start > 0:
            excerpt = '...' + excerpt
        if end < len(transcript):
            excerpt = excerpt + '...'
        
        excerpts.append({
            'text': excerpt,
            'sermon': sermon
        })
    
    return excerpts

def detect_story(sermons):
    """Detect personal story or illustration"""
    story_patterns = [
        'i remember when', 'i remember a time', 'let me tell you',
        'there was this', 'years ago', 'when i was',
        'i once met', 'i\'ll never forget'
    ]
    
    for sermon in sermons:
        transcript = sermon.get('transcript', '').lower()
        
        for pattern in story_patterns:
            pos = transcript.find(pattern)
            if pos != -1:
                # Extract story
                start = max(0, pos - 100)
                end = min(len(transcript), pos + 1200)
                story = transcript[start:end]
                
                # Clean up
                story = story.replace('[music]', '').replace('[applause]', '')
                
                # Check if it's not Bible exposition
                bible_words = ['jesus', 'moses', 'paul', 'peter', 'scripture']
                bible_count = sum(1 for word in bible_words if word in story)
                
                if bible_count < 2:
                    return {
                        'text': story,
                        'source': sermon.get('title', 'Untitled')
                    }
    
    return None

def synthesize_answer(excerpts, query):
    """Use OpenAI to synthesize comprehensive answer"""
    openai_client, _ = get_clients()
    
    # Prepare context
    context_parts = []
    for idx, excerpt in enumerate(excerpts):
        sermon = excerpt['sermon']
        context_parts.append(
            f"[Sermon {idx + 1}: \"{sermon.get('title', 'Untitled')}\"]\n{excerpt['text']}"
        )
    
    context = '\n\n---\n\n'.join(context_parts)
    
    # Call OpenAI
    response = openai_client.chat.completions.create(
        model='gpt-4o-mini',
        messages=[
            {
                'role': 'system',
                'content': """You are synthesizing Pastor Bob's teaching from sermon transcripts.

CRITICAL: Return ONLY valid JSON with this exact structure:
{
  "paragraphs": [
    "First paragraph with citation [1]",
    "Second paragraph with citation [2]",
    "Third paragraph with citation [3]",
    "Fourth paragraph with citation [4]"
  ]
}

CITATION RULES:
- You MUST use all 4 citations: [1], [2], [3], [4]
- Each paragraph should cite a DIFFERENT sermon (spread them out)
- Paragraph 1 must include [1]
- Paragraph 2 must include [2]
- Paragraph 3 must include [3]
- Paragraph 4 must include [4]

CONTENT RULES:
- Write 4 comprehensive paragraphs (4-6 sentences each)
- Include direct quotes from Pastor Bob
- Use warm, pastoral tone
- Include practical application
- Focus on what Pastor Bob actually teaches"""
            },
            {
                'role': 'user',
                'content': f"Question: {query}\n\nSermon excerpts:\n{context}\n\nProvide comprehensive answer with inline citations."
            }
        ],
        temperature=0.7,
        max_tokens=600,
        response_format={'type': 'json_object'}
    )
    
    result = json.loads(response.choices[0].message.content)
    return result.get('paragraphs', [])

def handler(event, context):
    """Netlify function handler"""
    try:
        # Parse request
        body = json.loads(event.get('body', '{}'))
        query = body.get('query', '').strip()
        
        if not query:
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'Query required'})
            }
        
        print(f"Searching for: {query}")
        
        # Vector search (FAST!)
        sermons = search_sermons(query, limit=4)
        
        if not sermons:
            return {
                'statusCode': 200,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({
                    'paragraphs': [f"I couldn't find relevant sermons about '{query}'."],
                    'citations': [],
                    'illustration': None,
                    'quotation': None,
                    'videos': []
                })
            }
        
        print(f"Found {len(sermons)} relevant sermons")
        
        # Extract excerpts for AI synthesis
        excerpts = extract_relevant_excerpts(sermons, query)
        
        # Synthesize answer
        paragraphs = synthesize_answer(excerpts, query)
        
        # Detect story
        illustration = detect_story(sermons)
        
        # Build response
        citations = []
        videos = []
        
        for sermon in sermons:
            citation = {
                'id': sermon.get('id', ''),
                'title': sermon.get('title', 'Untitled'),
                'url': sermon.get('url', ''),
                'date': sermon.get('date', ''),
                'scripture': sermon.get('scripture', '')
            }
            citations.append(citation)
            
            videos.append({
                'title': sermon.get('title', 'Untitled'),
                'youtubeVideo': {
                    'youtubeUrl': sermon.get('url', ''),
                    'scripture': sermon.get('scripture', ''),
                    'date': sermon.get('date', '')
                }
            })
        
        response = {
            'paragraphs': paragraphs,
            'citations': citations,
            'illustration': illustration,
            'quotation': None,  # Can add famous quote detection later
            'videos': videos
        }
        
        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps(response)
        }
    
    except Exception as e:
        print(f"Error: {str(e)}")
        import traceback
        traceback.print_exc()
        
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }
