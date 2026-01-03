"""
Enhanced Vector Search Function for Pastor Bob Sermons
Searches Qdrant vector database with AI-classified chunks

Features:
- YouTube timestamp links in responses
- AI classification (teaching/illustration/quote/story)
- Famous quote extraction
- Story detection
- Biblical reference tracking
"""

import json
import os
from typing import List, Dict, Any, Optional
from qdrant_client import QdrantClient
import openai

# Configuration from environment variables
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY', '')
QDRANT_URL = os.getenv('QDRANT_URL', '')
QDRANT_API_KEY = os.getenv('QDRANT_API_KEY', '')
COLLECTION_NAME = os.getenv('COLLECTION_NAME', 'pastor_bob_sermons')

# Initialize clients
openai.api_key = OPENAI_API_KEY
qdrant_client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)


def create_youtube_timestamp_url(base_url: str, timestamp_seconds: int) -> str:
    """
    Create a YouTube URL with timestamp parameter

    Args:
        base_url: YouTube video URL
        timestamp_seconds: Timestamp in seconds

    Returns:
        URL with timestamp parameter (?t=123s)
    """
    if not base_url or timestamp_seconds <= 0:
        return base_url

    # Check if URL already has parameters
    separator = '&' if '?' in base_url else '?'
    return f"{base_url}{separator}t={timestamp_seconds}s"


def format_timestamp(seconds: int) -> str:
    """
    Format seconds into HH:MM:SS or MM:SS

    Args:
        seconds: Time in seconds

    Returns:
        Formatted time string
    """
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60

    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    else:
        return f"{minutes:02d}:{secs:02d}"


def generate_embedding(query: str) -> List[float]:
    """
    Generate embedding vector for search query

    Args:
        query: User's search query

    Returns:
        Embedding vector
    """
    response = openai.embeddings.create(
        model="text-embedding-3-small",
        input=query
    )
    return response.data[0].embedding


def classify_chunks_realtime(chunks: List[str]) -> List[Dict[str, Any]]:
    """
    Classify chunks in real-time using OpenAI (only top results)
    Much faster than pre-classifying all 80k+ chunks

    Args:
        chunks: List of text chunks to classify (typically top 10-20)

    Returns:
        List of classifications for each chunk
    """
    if not chunks:
        return []

    # Build prompt for batch classification
    prompt = "Analyze these sermon excerpts and classify each one. Return a JSON array:\n\n"

    for i, chunk_text in enumerate(chunks):
        prompt += f"CHUNK {i+1}:\n{chunk_text[:500]}\n\n"

    prompt += """For EACH chunk, return a JSON object in an array:
[
  {
    "content_type": "teaching" | "illustration" | "quote" | "other",
    "has_illustration": true/false,
    "has_quote": true/false,
    "quote_author": "name" or null,
    "biblical_reference": "Book chapter:verse" or null,
    "is_story": true/false
  },
  ...
]

Rules:
- "teaching" = theological explanation, verse exposition, doctrine
- "illustration" = story, analogy, example, personal experience
- "quote" = citing famous person (Spurgeon, Luther, Augustine, Calvin, etc.)
- "is_story" = narrative with characters/plot
- Extract biblical refs like "Romans 8:28" or "Matthew 6:9-13"
- Only set quote_author for FAMOUS theologians/authors (not random people)

Return ONLY the JSON array, no markdown:"""

    try:
        response = openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=500 * len(chunks)
        )

        result = response.choices[0].message.content.strip()
        result = result.replace('```json', '').replace('```', '').strip()
        classifications = json.loads(result)

        # Ensure we got the right number back
        while len(classifications) < len(chunks):
            classifications.append({
                "content_type": "teaching",
                "has_illustration": False,
                "has_quote": False,
                "quote_author": None,
                "biblical_reference": None,
                "is_story": False
            })

        return classifications[:len(chunks)]

    except Exception as e:
        # Return default classifications on error
        print(f"Classification error: {e}")
        return [{
            "content_type": "teaching",
            "has_illustration": False,
            "has_quote": False,
            "quote_author": None,
            "biblical_reference": None,
            "is_story": False
        } for _ in chunks]


def search_vector_db(query: str, limit: int = 50, classify_top: int = 20) -> List[Dict[str, Any]]:
    """
    Search Qdrant vector database and classify top results in real-time

    Args:
        query: User's search query
        limit: Maximum number of results to retrieve
        classify_top: Number of top results to classify with AI (default 20)

    Returns:
        List of matching chunks with metadata and AI classification
    """
    # Generate query embedding
    query_vector = generate_embedding(query)

    # Search Qdrant
    search_results = qdrant_client.query_points(
        collection_name=COLLECTION_NAME,
        query=query_vector,
        limit=limit,
        with_payload=True
    ).points

    # Extract results with basic metadata
    results = []
    for hit in search_results:
        payload = hit.payload
        results.append({
            'score': hit.score,
            'text': payload.get('text', ''),
            'title': payload.get('title', ''),
            'url': payload.get('url', ''),
            'timestamp_seconds': payload.get('timestamp_seconds', 0),
            'chunk_id': payload.get('chunk_id', 0),
            'has_youtube_url': payload.get('has_youtube_url', False)
        })

    # Classify top N results in real-time (takes ~2 seconds)
    if results and classify_top > 0:
        top_results = results[:classify_top]
        chunks_to_classify = [r['text'] for r in top_results]

        classifications = classify_chunks_realtime(chunks_to_classify)

        # Apply classifications to top results
        for result, classification in zip(top_results, classifications):
            result['content_type'] = classification.get('content_type', 'teaching')
            result['has_illustration'] = classification.get('has_illustration', False)
            result['has_quote'] = classification.get('has_quote', False)
            result['quote_author'] = classification.get('quote_author')
            result['biblical_reference'] = classification.get('biblical_reference')
            result['is_story'] = classification.get('is_story', False)

        # Add default values to remaining results
        for result in results[classify_top:]:
            result['content_type'] = 'teaching'
            result['has_illustration'] = False
            result['has_quote'] = False
            result['quote_author'] = None
            result['biblical_reference'] = None
            result['is_story'] = False

    return results


def categorize_results(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Categorize search results into paragraphs, citations, illustrations,
    quotations, and videos with enhanced metadata

    Args:
        results: List of search results from vector DB

    Returns:
        Categorized and formatted results
    """
    paragraphs = []
    citations = []
    illustrations = []
    quotations = []
    videos = []

    # Track unique videos
    seen_videos = set()

    for result in results:
        # Create YouTube timestamp URL if available
        timestamp_url = None
        if result['has_youtube_url'] and result['url']:
            timestamp_url = create_youtube_timestamp_url(
                result['url'],
                result['timestamp_seconds']
            )

        # Build base chunk info
        chunk_info = {
            'text': result['text'],
            'title': result['title'],
            'url': result['url'],
            'timestamp_url': timestamp_url,
            'timestamp': format_timestamp(result['timestamp_seconds']),
            'timestamp_seconds': result['timestamp_seconds'],
            'score': round(result['score'], 3),
            'content_type': result['content_type'],
            'biblical_reference': result['biblical_reference']
        }

        # Categorize by type

        # 1. Quotations (famous quotes from theologians/authors)
        if result['has_quote'] and result['quote_author']:
            quotations.append({
                **chunk_info,
                'author': result['quote_author'],
                'type': 'quote'
            })

        # 2. Illustrations (stories, examples, analogies)
        elif result['is_story'] or result['has_illustration']:
            illustrations.append({
                **chunk_info,
                'is_story': result['is_story'],
                'type': 'illustration' if not result['is_story'] else 'story'
            })

        # 3. Citations (biblical references in teaching)
        elif result['biblical_reference']:
            citations.append({
                **chunk_info,
                'reference': result['biblical_reference'],
                'type': 'citation'
            })

        # 4. General teaching paragraphs
        else:
            paragraphs.append({
                **chunk_info,
                'type': result['content_type']
            })

        # 5. Track unique videos
        if result['has_youtube_url'] and result['url']:
            video_key = (result['url'], result['title'])
            if video_key not in seen_videos:
                seen_videos.add(video_key)
                videos.append({
                    'title': result['title'],
                    'url': result['url'],
                    'timestamp_url': timestamp_url,
                    'timestamp': format_timestamp(result['timestamp_seconds']),
                    'relevance_score': round(result['score'], 3)
                })

    # Sort each category by relevance score (descending)
    paragraphs.sort(key=lambda x: x['score'], reverse=True)
    citations.sort(key=lambda x: x['score'], reverse=True)
    illustrations.sort(key=lambda x: x['score'], reverse=True)
    quotations.sort(key=lambda x: x['score'], reverse=True)
    videos.sort(key=lambda x: x['relevance_score'], reverse=True)

    return {
        'paragraphs': paragraphs[:20],  # Top 20 general teaching
        'citations': citations[:10],     # Top 10 biblical citations
        'illustrations': illustrations[:10],  # Top 10 illustrations/stories
        'quotations': quotations[:5],    # Top 5 famous quotes
        'videos': videos[:5],            # Top 5 most relevant videos
        'total_results': len(results),
        'breakdown': {
            'teaching': len([r for r in results if r['content_type'] == 'teaching']),
            'illustrations': len([r for r in results if r['has_illustration']]),
            'stories': len([r for r in results if r['is_story']]),
            'quotes': len([r for r in results if r['has_quote']]),
            'with_scripture': len([r for r in results if r['biblical_reference']])
        }
    }


def handler(event, context):
    """
    Netlify Function handler for vector search

    Args:
        event: Netlify event object
        context: Netlify context object

    Returns:
        HTTP response with search results
    """
    try:
        # Parse request body
        if event.get('httpMethod') != 'POST':
            return {
                'statusCode': 405,
                'body': json.dumps({'error': 'Method not allowed. Use POST.'})
            }

        body = json.loads(event.get('body', '{}'))
        query = body.get('query', '').strip()
        limit = min(int(body.get('limit', 50)), 100)  # Max 100 results

        if not query:
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'Query parameter is required'})
            }

        # Perform vector search
        search_results = search_vector_db(query, limit=limit)

        # Categorize and format results
        categorized = categorize_results(search_results)

        # Build response
        response = {
            'query': query,
            'results': categorized,
            'metadata': {
                'collection': COLLECTION_NAME,
                'total_chunks_searched': limit,
                'embedding_model': 'text-embedding-3-small'
            }
        }

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            'body': json.dumps(response, indent=2)
        }

    except Exception as e:
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e)
            })
        }


# For local testing
if __name__ == '__main__':
    # Test query
    test_event = {
        'httpMethod': 'POST',
        'body': json.dumps({
            'query': 'What does Pastor Bob teach about the rapture?',
            'limit': 30
        })
    }

    result = handler(test_event, {})
    print(json.dumps(json.loads(result['body']), indent=2))
