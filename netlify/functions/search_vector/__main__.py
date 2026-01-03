"""
Enhanced Sermon Search with:
- AI intro paragraph
- YouTube timestamp links
- Illustrations & stories
- Famous quotes
- Fast performance (2-3 sec)
"""

import json
import os
from openai import OpenAI
from qdrant_client import QdrantClient

# Config
OPENAI_API_KEY = os.environ.get('opeaikey') or os.environ.get('OPENAI_API_KEY')
QDRANT_URL = os.environ.get('QDRANT_URL')
QDRANT_API_KEY = os.environ.get('QDRANT_API_KEY')
COLLECTION_NAME = "pastor_bob_sermons"

openai_client = None
qdrant_client = None

def get_clients():
    global openai_client, qdrant_client
    if not openai_client:
        openai_client = OpenAI(api_key=OPENAI_API_KEY)
    if not qdrant_client:
        qdrant_client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY, timeout=30)
    return openai_client, qdrant_client

def search_chunks(query, limit=15):
    """Search Qdrant for relevant chunks"""
    openai_client, qdrant_client = get_clients()
    
    # Generate embedding
    response = openai_client.embeddings.create(
        model="text-embedding-3-small",
        input=[query]
    )
    query_vector = response.data[0].embedding
    
    # Search
    results = qdrant_client.query_points(
        collection_name=COLLECTION_NAME,
        query=query_vector,
        limit=limit
    ).points
    
    chunks = []
    for r in results:
        chunks.append({
            'text': r.payload.get('text', ''),
            'title': r.payload.get('title', ''),
            'url': r.payload.get('url', ''),
            'timestamp': r.payload.get('timestamp_seconds', 0),
            'score': r.score
        })
    
    return chunks

def build_timestamp_url(url, timestamp):
    """Create YouTube URL with timestamp"""
    if not url or not timestamp:
        return url
    separator = '&' if '?' in url else '?'
    return f"{url}{separator}t={int(timestamp)}s"

def generate_intro(query, chunks):
    """Generate AI intro paragraph explaining the topic"""
    openai_client, _ = get_clients()
    
    # Check if Pastor Bob has taught on this
    has_content = any(c['score'] > 0.5 for c in chunks[:3])
    
    if has_content:
        context = "\n\n".join([c['text'][:300] for c in chunks[:3]])
        prompt = f"""Based on Pastor Bob's sermons, write a 2-3 sentence introduction to this topic: "{query}"

Sermon context:
{context}

Write as Pastor Bob would introduce this topic. Be warm and pastoral."""
    else:
        prompt = f"""Write a 2-3 sentence biblical introduction to: "{query}"

Explain what it means biblically and where it's found in Scripture. Be clear and pastoral."""
    
    response = openai_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.7,
        max_tokens=150
    )
    
    return response.choices[0].message.content.strip()

def classify_and_synthesize(chunks, query):
    """Classify chunks and build response"""
    openai_client, _ = get_clients()
    
    # Build context with links
    context_parts = []
    for i, chunk in enumerate(chunks[:8], 1):
        link = build_timestamp_url(chunk['url'], chunk['timestamp'])
        context_parts.append(
            f"[{i}] {chunk['title']}\n"
            f"Link: {link}\n"
            f"Text: {chunk['text'][:400]}\n"
        )
    
    context = "\n".join(context_parts)
    
    prompt = f"""You are synthesizing Pastor Bob's teaching. Use the sermon excerpts to answer this question: "{query}"

{context}

Return ONLY valid JSON:
{{
  "paragraphs": ["paragraph 1 with markdown link [Watch here](url)", "paragraph 2...", "paragraph 3..."],
  "illustration": {{"text": "story text", "source": "sermon title", "link": "url"}} or null,
  "quotation": {{"text": "quote text", "author": "Famous Person", "source": "sermon title", "link": "url"}} or null
}}

Rules:
- Write 2-3 paragraphs in Pastor Bob's warm, pastoral voice
- Include clickable markdown links: [Watch this moment](full-url-with-timestamp)
- Find ONE good story/illustration if present
- Find ONE famous person quote (Spurgeon, Luther, etc.) if present
- Use actual content from the excerpts provided"""

    response = openai_client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.7,
        max_tokens=1000,
        response_format={'type': 'json_object'}
    )
    
    return json.loads(response.choices[0].message.content)

def handler(event, context):
    """Main handler"""
    try:
        body = json.loads(event.get('body', '{}'))
        query = body.get('query', '').strip()
        
        if not query:
            return {'statusCode': 400, 'body': json.dumps({'error': 'Query required'})}
        
        print(f"Search: {query}")
        
        # 1. Vector search (fast)
        chunks = search_chunks(query, limit=15)
        
        if not chunks:
            return {
                'statusCode': 200,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({
                    'paragraphs': [f"No sermons found about '{query}'."],
                    'citations': [],
                    'illustration': None,
                    'quotation': None,
                    'videos': []
                })
            }
        
        # 2. Generate intro paragraph
        intro = generate_intro(query, chunks)
        
        # 3. Classify and synthesize
        result = classify_and_synthesize(chunks, query)
        
        # 4. Build final response
        paragraphs = [intro] + result.get('paragraphs', [])
        
        # 5. Build citations with timestamp links
        citations = []
        videos = []
        seen = set()
        
        for chunk in chunks[:5]:
            if chunk['title'] in seen:
                continue
            seen.add(chunk['title'])
            
            link = build_timestamp_url(chunk['url'], chunk['timestamp'])
            
            citations.append({
                'title': chunk['title'],
                'url': link,
                'timestamp': chunk['timestamp']
            })
            
            videos.append({
                'title': chunk['title'],
                'youtubeVideo': {'youtubeUrl': link}
            })
        
        response = {
            'paragraphs': paragraphs,
            'citations': citations,
            'illustration': result.get('illustration'),
            'quotation': result.get('quotation'),
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
        return {'statusCode': 500, 'body': json.dumps({'error': str(e)})}
