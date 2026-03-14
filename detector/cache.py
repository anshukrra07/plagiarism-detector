# cache.py — SHA-256 Embedding Cache backed by MongoDB
#
# Pipeline: sentence → sha256 hash → MongoDB lookup
#   HIT  → return stored 384-dim vector (~1ms, model skipped entirely)
#   MISS → call SBERT model (~10-50ms) → store in MongoDB for next time

import hashlib
import os
import numpy as np
from pymongo import MongoClient
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# ── MongoDB setup (lazy init) ─────────────────────────────────────────────────

_db    = None
_cache = None

def _get_cache():
    global _db, _cache
    if _cache is None:
        _db    = MongoClient(os.getenv("MONGODB_URI", "mongodb://localhost:27017"))["plagiarism_db"]
        _cache = _db["embedding_cache"]
        # NOTE: MongoDB auto-creates a unique index on _id — do NOT call
        # create_index("_id", unique=True) or it raises OperationFailure.
        # Only create the secondary index for analytics queries.
        _cache.create_index("hit_count")
    return _cache


# ── Hash helper ───────────────────────────────────────────────────────────────

def _sha256(text: str) -> str:
    """SHA-256 hex digest — stable across Python runs (unlike hash())."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ── Single sentence lookup ────────────────────────────────────────────────────

def get_embedding(sentence: str, model_encode_fn) -> np.ndarray:
    """
    Get embedding for a sentence — from cache or from model.

    Args:
        sentence:        The sentence string to embed.
        model_encode_fn: encode_single from detector.embedder

    Returns:
        np.ndarray of shape (384,)
    """
    key   = _sha256(sentence)
    cache = _get_cache()

    try:
        cached = cache.find_one({"_id": key})
    except Exception:
        cached = None

    if cached:
        # CACHE HIT
        try:
            cache.update_one({"_id": key}, {"$inc": {"hit_count": 1}})
        except Exception:
            pass
        return np.array(cached["embedding"], dtype=np.float32)

    # CACHE MISS — compute then store
    embedding = model_encode_fn(sentence)
    try:
        cache.insert_one({
            "_id":        key,
            "sentence":   sentence,
            "embedding":  embedding.tolist(),
            "created_at": datetime.utcnow(),
            "hit_count":  0,
        })
    except Exception:
        pass  # duplicate insert from race condition — fine

    return embedding


# ── Batch lookup (primary interface used by pipeline.py) ─────────────────────

def get_embeddings_batch(sentences: list, model_encode_fn) -> np.ndarray:
    """
    Get embeddings for a list of sentences with cache-first lookup.

    Checks all sentences against MongoDB in one query, batches all misses
    into a single model call, then stores new embeddings in one bulk insert.
    At most: 1 DB read + 1 model call + 1 DB write per batch.
    """
    if not sentences:
        return np.array([])

    cache    = _get_cache()
    keys     = [_sha256(s) for s in sentences]
    results  = [None] * len(sentences)
    miss_idx = []

    # Bulk-fetch all known keys in one query
    try:
        docs = {
            doc["_id"]: doc["embedding"]
            for doc in cache.find({"_id": {"$in": keys}}, {"embedding": 1})
        }
    except Exception:
        docs = {}

    for i, key in enumerate(keys):
        if key in docs:
            results[i] = np.array(docs[key], dtype=np.float32)
            try:
                cache.update_one({"_id": key}, {"$inc": {"hit_count": 1}})
            except Exception:
                pass
        else:
            miss_idx.append(i)

    # Batch-encode all misses in one model call
    if miss_idx:
        miss_sentences  = [sentences[i] for i in miss_idx]
        miss_embeddings = model_encode_fn(miss_sentences)

        for pos, i in enumerate(miss_idx):
            results[i] = miss_embeddings[pos]
            try:
                cache.insert_one({
                    "_id":        keys[i],
                    "sentence":   sentences[i],
                    "embedding":  miss_embeddings[pos].tolist(),
                    "created_at": datetime.utcnow(),
                    "hit_count":  0,
                })
            except Exception:
                pass

    return np.array(results)


# ── Cache statistics ──────────────────────────────────────────────────────────

def cache_stats() -> dict:
    """Return cache usage stats — useful for the dashboard."""
    cache = _get_cache()
    total = cache.count_documents({})
    agg   = list(cache.aggregate([
        {"$group": {"_id": None, "total_hits": {"$sum": "$hit_count"}}}
    ]))
    total_hits     = agg[0]["total_hits"] if agg else 0
    total_requests = total_hits + total
    hit_rate       = f"{(total_hits / total_requests * 100):.1f}%" if total_requests else "0%"
    size_mb        = round((total * 1736) / (1024 ** 2), 2)
    return {
        "cached_sentences": total,
        "total_hits":       total_hits,
        "hit_rate":         hit_rate,
        "size_estimate_mb": size_mb,
    }


# ── Cache management ──────────────────────────────────────────────────────────

def clear_cache() -> int:
    """Delete all cached embeddings. Returns number deleted."""
    result = _get_cache().delete_many({})
    return result.deleted_count