import os, tempfile, io
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pymongo import MongoClient, DESCENDING
from dotenv import load_dotenv
from detector.cluster import detect_clusters, cluster_result_to_dict
from fastapi.responses import StreamingResponse
from detector.feedback import generate_feedback, feedback_to_dict
from detector.ai_detector import detect_ai_content, ai_result_to_dict
from detector.report_generator import generate_report


import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

load_dotenv()

from detector.pipeline import check_document, check_text as _check_text
from detector.corpus   import corpus_stats, fetch_wikipedia, fetch_arxiv, fetch_ieee, add_to_corpus
from detector.cache    import cache_stats, clear_cache
from detector.embedder import encode
from detector.detector import SentenceResult, DocumentResult

app = FastAPI(
    title="AI Plagiarism Detector",
    description="3-layer semantic plagiarism detection.",
    version="1.0.0",
)

_cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# FIX [HIGH]: Reuse a single MongoClient — was creating new connections in _save_pairs and /pairs
_mongo_client = None
_mongo_db     = None
_submissions  = None
_pairs_col    = None
_pairs_cache  = []  # In-memory fallback when MongoDB is unavailable

def _get_mongo_db():
    global _mongo_client, _mongo_db
    if _mongo_db is None:
        _mongo_client = MongoClient(os.getenv("MONGODB_URI", "mongodb://localhost:27017"))
        _mongo_db     = _mongo_client["plagiarism_db"]
    return _mongo_db

def _get_submissions():
    global _submissions
    if _submissions is None:
        db           = _get_mongo_db()
        _submissions = db["submissions"]
        _submissions.create_index(
            "submitted_at",
            expireAfterSeconds=60 * 60 * 24 * 30
        )
        _submissions.create_index([("overall_score", DESCENDING)])
    return _submissions

def _get_pairs_col():
    global _pairs_col
    if _pairs_col is None:
        _pairs_col = _get_mongo_db()["pairs"]
        _pairs_col.create_index([("similarity", DESCENDING)])
    return _pairs_col


class TextCheckRequest(BaseModel):
    text: str
    auto_fetch_corpus: bool = True
    sources: Optional[list[str]] = None
    student_name: Optional[str] = None   # FIX [MEDIUM]: collected in UI but never stored

class SeedCorpusRequest(BaseModel):
    query: str
    sources: list[str] = ["wikipedia", "arxiv"]
    lang: str = "en"
    max_sentences: int = 50

class BatchCompareRequest(BaseModel):
    texts:      list[str]
    labels:     Optional[list[str]] = None
    threshold:  float = 0.70
    timestamps: Optional[list[str]] = None   # FIX [CRITICAL]: was missing — needed for arrow direction

class ClusterRequest(BaseModel):
    texts:       list[str]
    labels:      Optional[list[str]] = None
    eps:         float = 0.22
    min_samples: int   = 2

class FeedbackRequest(BaseModel):
    sentence:    str
    label:       str
    score:       float
    source_url:  str = "unknown"
    confidence:  str = "Medium"
    matched_src: str = ""

class AIDetectRequest(BaseModel):
    text: str

class AddPairRequest(BaseModel):
    student_a: str
    student_b: str
    similarity: float
    flagged_sentences: int = 0
    copier: Optional[str] = None
    original: Optional[str] = None
    direction_confidence: str = "Low"
    direction_signals: Optional[dict] = None
    is_common_source: bool = False
    submitted_a: Optional[str] = None
    submitted_b: Optional[str] = None
    sentence_pairs: Optional[list[dict]] = None


def _sentence_result_to_dict(r: SentenceResult) -> dict:
    return {
        "sentence":           r.sentence,
        "score":              round(r.score, 4),
        "label":              r.label,
        "confidence":         r.confidence,
        "layer_hit":          r.layer_hit,
        "layers_flagged":     r.layers_flagged,
        "matched_source":     r.matched_source,
        "source_name":        r.source_name,
        "source_url":         r.source_url,
        "source_credibility": r.source_credibility,
        "explanation":        r.explanation,
    }

def _doc_result_to_dict(result: DocumentResult, sid: str = "") -> dict:
    return {
        "submission_id":   sid,
        "overall_score":   result.overall_score,
        "label":           result.label,
        "confidence":      result.confidence,
        "flagged_count":   result.flagged_count,
        "total_sentences": result.total_sentences,
        "section_scores":  result.section_scores,
        "ai_detection":    result.ai_detection,
        "source_fetch":    result.source_fetch,
        "sentences": [_sentence_result_to_dict(r) for r in result.sentence_results],
    }


@app.post("/check/file")
async def check_file(
    file: UploadFile = File(...),
    auto_fetch_corpus: bool = Query(True),
    sources: Optional[list[str]] = Form(None),
    student_name: Optional[str] = Form(None),
):
    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in {"pdf", "docx", "txt"}:
        raise HTTPException(400, f"Unsupported: .{ext}")

    with tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}") as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    try:
        result = check_document(
            tmp_path,
            auto_fetch_corpus=auto_fetch_corpus,
            corpus_sources=_validate_corpus_sources(sources),
        )
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        os.unlink(tmp_path)

    sid = _save_submission(result, filename=file.filename, student_name=student_name)
    return _doc_result_to_dict(result, sid)


@app.post("/check/text")
async def check_text_endpoint(body: TextCheckRequest):
    if not body.text.strip():
        raise HTTPException(400, "Text cannot be empty.")
    if len(body.text) > 100_000:
        raise HTTPException(400, "Text too long. Max 100,000 characters.")
    try:
        result = _check_text(
            body.text,
            auto_fetch_corpus=body.auto_fetch_corpus,
            corpus_sources=_validate_corpus_sources(body.sources),
        )
    except Exception as e:
        raise HTTPException(500, str(e))
    sid = _save_submission(result, filename="[text input]", student_name=body.student_name)
    return _doc_result_to_dict(result, sid)


@app.get("/corpus/stats")
def get_corpus_stats():
    return corpus_stats()

@app.get("/cache/stats")
def get_cache_stats():
    return cache_stats()

@app.post("/corpus/seed")
def seed_corpus(body: SeedCorpusRequest):
    sources = _validate_corpus_sources(body.sources)
    added = 0
    if "wikipedia" in sources:
        added += add_to_corpus(fetch_wikipedia(body.query, lang=body.lang,
                                               max_sentences=body.max_sentences))
    if "arxiv" in sources:
        added += add_to_corpus(fetch_arxiv(body.query, max_papers=3))
    if "ieee" in sources:
        added += add_to_corpus(fetch_ieee(body.query, max_records=3))
    return {"query": body.query, "sentences_added": added,
            "corpus_total": corpus_stats()["total_sentences"]}

@app.get("/submissions")
def list_submissions(limit: int = Query(20, le=100), skip: int = 0):
    docs = list(_get_submissions()
                .find({}, {"sentence_results": 0})
                .sort("submitted_at", DESCENDING)
                .skip(skip).limit(limit))
    for d in docs:
        d["_id"] = str(d["_id"])
        d["submission_id"] = d["_id"]   # FIX [MEDIUM]: was missing submission_id alias
    return {"submissions": docs, "count": len(docs)}

# FIX [HIGH]: Missing GET /submissions/{id} endpoint
@app.get("/submissions/{submission_id}")
def get_submission(submission_id: str):
    from bson import ObjectId
    try:
        oid = ObjectId(submission_id)
    except Exception:
        raise HTTPException(400, f"Invalid submission ID: {submission_id}")
    doc = _get_submissions().find_one({"_id": oid})
    if not doc:
        raise HTTPException(404, f"Submission {submission_id} not found.")
    doc["_id"]           = str(doc["_id"])
    doc["submission_id"] = doc["_id"]
    return doc

@app.get("/health")
def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


def _validate_corpus_sources(sources: Optional[list[str]]) -> Optional[list[str]]:
    if sources is None:
        return None
    allowed = {"wikipedia", "arxiv", "ieee", "stored"}
    cleaned = []
    for source in sources:
        source_l = source.lower()
        if source_l not in allowed:
            raise HTTPException(400, f"Unsupported source: {source}")
        if source_l not in cleaned:
            cleaned.append(source_l)
    return cleaned

@app.delete("/cache")
def delete_cache():
    deleted = clear_cache()
    return {"deleted": deleted}



# ── Edit distance helpers (no extra deps) ────────────────────────────────────

def _edit_distance_pct(a: str, b: str) -> int:
    """
    Word-level edit distance as % of longer sentence.
    0% = identical, 100% = completely different.
    """
    wa = a.lower().split()
    wb = b.lower().split()
    if not wa or not wb:
        return 100
    # Simple LCS-based word diff
    m, n = len(wa), len(wb)
    dp = [[0]*(n+1) for _ in range(m+1)]
    for i in range(1, m+1):
        for j in range(1, n+1):
            dp[i][j] = dp[i-1][j-1]+1 if wa[i-1]==wb[j-1] else max(dp[i-1][j], dp[i][j-1])
    common = dp[m][n]
    changed = max(m, n) - common
    return round(changed / max(m, n) * 100)


def _mod_label(edit_pct: int) -> str:
    """Human-readable modification level for the UI."""
    if edit_pct <= 10:  return "Direct copy"
    if edit_pct <= 30:  return "Minor edits"
    if edit_pct <= 55:  return "Moderate edits"
    if edit_pct <= 75:  return "Heavy edits"
    return "Heavily modified"

@app.post("/compare/batch")
def compare_batch(body: BatchCompareRequest):
    if len(body.texts) < 2:
        raise HTTPException(400, "Need at least 2 texts.")

    # FIX [MEDIUM]: validate labels length
    if body.labels and len(body.labels) != len(body.texts):
        raise HTTPException(400, f"labels length ({len(body.labels)}) must match texts length ({len(body.texts)}).")

    labels = body.labels or [f"Student {i+1}" for i in range(len(body.texts))]

    import numpy as np
    import nltk
    nltk.download("punkt", quiet=True); nltk.download("punkt_tab", quiet=True)
    from nltk.tokenize import sent_tokenize
    from detector.extractor import filter_cited_sentences

    # FIX [MEDIUM]: was writing NamedTemporaryFile per student — now tokenizes in-memory
    all_embeddings, all_sentences = [], []
    for text in body.texts:
        raw   = sent_tokenize(text)
        sents = [s.strip() for s in raw if len(s.split()) >= 5]
        sents, _ = filter_cited_sentences(sents)
        embs = encode(sents) if sents else np.zeros((0, 384))
        all_sentences.append(sents)
        all_embeddings.append(embs)

    pairs = []
    n = len(body.texts)
    for i in range(n):
        for j in range(i + 1, n):
            ei, ej = all_embeddings[i], all_embeddings[j]
            if ei.shape[0] == 0 or ej.shape[0] == 0: continue
            sim = ei @ ej.T
            top = sim.max(axis=1)
            flagged = top > body.threshold
            if flagged.sum() > 0:
                ts_a = body.timestamps[i] if body.timestamps and i < len(body.timestamps) else None
                ts_b = body.timestamps[j] if body.timestamps and j < len(body.timestamps) else None

                # ── Sentence-level analysis ───────────────────────────────
                flagged_idx = [k for k, f in enumerate(flagged) if f]
                sent_pairs  = []
                # edit distance asymmetry votes:
                # student whose sentence has LOWER edit distance from the pair
                # is more likely the original (copier changed words, original didn't)
                edit_votes_a = 0
                edit_votes_b = 0

                for k in flagged_idx[:10]:
                    sent_a  = all_sentences[i][k]
                    best_j  = int(sim[k].argmax())
                    sent_b  = all_sentences[j][best_j] if best_j < len(all_sentences[j]) else ""

                    ed_ab = _edit_distance_pct(sent_a, sent_b)  # how much b differs from a
                    ed_ba = _edit_distance_pct(sent_b, sent_a)  # how much a differs from b
                    # They're symmetric by our formula — use a better asymmetric signal:
                    # check which sentence is closer to the CORPUS (more original = more in corpus)
                    # Simple proxy: shorter avg word length = simpler = less padded = more original

                    words_a = sent_a.lower().split()
                    words_b = sent_b.lower().split()
                    avg_wlen_a = sum(len(w) for w in words_a) / max(len(words_a), 1)
                    avg_wlen_b = sum(len(w) for w in words_b) / max(len(words_b), 1)

                    # Copier tends to use more sophisticated synonyms (longer words)
                    # Original tends to use simpler, more direct language
                    if avg_wlen_a < avg_wlen_b - 0.3:   # a uses simpler words → a more likely original
                        edit_votes_a += 1
                        sent_owner = labels[i]
                    elif avg_wlen_b < avg_wlen_a - 0.3:
                        edit_votes_b += 1
                        sent_owner = labels[j]
                    else:
                        sent_owner = labels[i]  # tie — no vote

                    sent_pairs.append({
                        "sentence_a":   sent_a,
                        "sentence_b":   sent_b,
                        "similarity":   round(float(sim[k, best_j]), 3),
                        "edit_pct":     ed_ab,
                        "owner":        sent_owner,
                        "modification": _mod_label(ed_ab),
                    })

                # ── Cross-corpus check ────────────────────────────────────
                # If both flagged sentences already match the CORPUS, neither
                # student copied each other — both copied an external source.
                # Query corpus for each flagged sentence and count corpus hits.
                corpus_hits_a = 0
                corpus_hits_b = 0
                common_source_pairs = 0
                try:
                    from detector.corpus import query_corpus
                    for sp in sent_pairs[:5]:   # check first 5 to limit latency
                        # Encode both sentences and check corpus similarity
                        emb_a = encode([sp["sentence_a"]])[0]
                        emb_b = encode([sp["sentence_b"]])[0]
                        corp_sents_a, _, _, corp_embs_a = query_corpus(emb_a, top_k=1)
                        corp_sents_b, _, _, corp_embs_b = query_corpus(emb_b, top_k=1)
                        hit_a = float(corp_embs_a[0] @ emb_a) > 0.85 if len(corp_embs_a) > 0 else False
                        hit_b = float(corp_embs_b[0] @ emb_b) > 0.85 if len(corp_embs_b) > 0 else False
                        if hit_a: corpus_hits_a += 1
                        if hit_b: corpus_hits_b += 1
                        if hit_a and hit_b: common_source_pairs += 1
                except Exception:
                    pass  # corpus unavailable — skip this check

                # If majority of flagged pairs both hit corpus → common source, not peer copying
                is_common_source = (
                    len(sent_pairs) > 0 and
                    common_source_pairs / len(sent_pairs) >= 0.5
                )

                # ── 3-signal original/copier decision ────────────────────
                #
                # Signal 1 — Submission time
                #   Earlier submitter = original (reliable when gap > 1 hour)
                #   Weight: 3 votes when gap > 1hr, 1 vote when gap < 1hr
                #
                # Signal 2 — Sentence vocabulary complexity
                #   Student using simpler direct language = original
                #   (copiers use synonyms/paraphrase → longer avg word length)
                #   Weight: 1 vote per signal
                #
                # Signal 3 — Semantic proportion
                #   Student with higher flagged% relative to total = copier
                #   Only counted when gap > 20% between the two proportions
                #   Weight: 1 vote

                votes_a  = 0   # votes for labels[i] being ORIGINAL
                votes_b  = 0   # votes for labels[j] being ORIGINAL
                signals  = {}
                max_votes = 0

                # Signal 1: timestamp — weighted by gap size
                if ts_a and ts_b and ts_a != ts_b:
                    try:
                        from datetime import datetime
                        fmt = "%Y-%m-%dT%H:%M"
                        dt_a = datetime.fromisoformat(ts_a[:16])
                        dt_b = datetime.fromisoformat(ts_b[:16])
                        gap_hrs = abs((dt_b - dt_a).total_seconds()) / 3600
                        weight = 3 if gap_hrs > 1 else 1   # strong signal for > 1hr gap
                        if dt_a < dt_b:
                            votes_a += weight
                            signals["time"] = f"{labels[i]} submitted {gap_hrs:.1f}h earlier"
                        else:
                            votes_b += weight
                            signals["time"] = f"{labels[j]} submitted {gap_hrs:.1f}h earlier"
                        max_votes += weight
                    except Exception:
                        signals["time"] = "timestamp parse error"
                else:
                    signals["time"] = "same time or unavailable — no vote"

                # Signal 2: vocabulary complexity (edit asymmetry proxy)
                if edit_votes_a > edit_votes_b:
                    votes_a += 1
                    signals["ownership"] = f"{labels[i]} uses simpler vocabulary — likely original"
                elif edit_votes_b > edit_votes_a:
                    votes_b += 1
                    signals["ownership"] = f"{labels[j]} uses simpler vocabulary — likely original"
                else:
                    signals["ownership"] = "vocabulary complexity tied — no vote"
                max_votes += 1

                # Signal 3: semantic proportion (only when gap > 20%)
                total_a = len(all_sentences[i]) or 1
                total_b = len(all_sentences[j]) or 1
                ratio_a = flagged.sum() / total_a
                ratio_b = float((sim.T.max(axis=1) > body.threshold).sum()) / total_b
                prop_gap = abs(ratio_a - ratio_b)
                if prop_gap > 0.20:
                    if ratio_a > ratio_b:
                        votes_b += 1   # i has higher flagged% → i is copier → j is original
                        signals["semantic"] = f"{labels[i]} {ratio_a:.0%} flagged vs {labels[j]} {ratio_b:.0%} — {labels[i]} likely copier"
                    else:
                        votes_a += 1
                        signals["semantic"] = f"{labels[j]} {ratio_b:.0%} flagged vs {labels[i]} {ratio_a:.0%} — {labels[j]} likely copier"
                    max_votes += 1
                else:
                    signals["semantic"] = f"proportion gap too small ({prop_gap:.0%}) — no vote"

                # ── Final decision ────────────────────────────────────────
                if is_common_source:
                    # Both copied a third party — don't assign blame
                    original = f"{labels[i]} / {labels[j]}"
                    copier   = "Common source (external)"
                    direction_confidence = "Common Source"
                    signals["corpus"] = f"{common_source_pairs}/{len(sent_pairs)} flagged sentences found in corpus — both may have copied an external source"
                elif votes_a > votes_b:
                    original = labels[i]
                    copier   = labels[j]
                    direction_confidence = "High" if votes_a >= max_votes * 0.75 else "Medium"
                elif votes_b > votes_a:
                    original = labels[j]
                    copier   = labels[i]
                    direction_confidence = "High" if votes_b >= max_votes * 0.75 else "Medium"
                else:
                    # Tie — fallback priority: timestamp > proportion > inconclusive
                    if ts_a and ts_b and ts_a != ts_b:
                        original = labels[i] if ts_a < ts_b else labels[j]
                        copier   = labels[j] if ts_a < ts_b else labels[i]
                    elif prop_gap > 0.10:
                        original = labels[j] if ratio_a > ratio_b else labels[i]
                        copier   = labels[i] if ratio_a > ratio_b else labels[j]
                    else:
                        original = labels[i]
                        copier   = labels[j]
                    direction_confidence = "Low"
                    signals["note"] = "Signals tied — result is indicative only, manual review required"

                pairs.append({
                    "student_a":            labels[i],
                    "student_b":            labels[j],
                    "similarity":           round(float(top[flagged].mean()), 4),
                    "flagged_sentences":    int(flagged.sum()),
                    "copier":               copier,
                    "original":             original,
                    "direction_confidence": direction_confidence,
                    "direction_signals":    signals,
                    "is_common_source":     is_common_source,
                    "corpus_hits_a":        corpus_hits_a,
                    "corpus_hits_b":        corpus_hits_b,
                    "submitted_a":          ts_a,
                    "submitted_b":          ts_b,
                    "sentence_pairs":       sent_pairs,
                })

    # Delete all existing pairs involving ANY of the students in this batch
    # before saving new ones — prevents duplicate rings across re-submissions
    _delete_pairs_for_students(labels)
    _save_pairs(pairs)
    pairs.sort(key=lambda p: p["similarity"], reverse=True)

    try:
        cluster_res  = detect_clusters(texts=body.texts, labels=labels)
        cluster_data = cluster_result_to_dict(cluster_res)
    except Exception:
        cluster_data = {"rings": [], "node_cluster_map": {}}

    return {
        "flagged_pairs": len(pairs),
        "pairs":         pairs,
        "clustering":    cluster_data,
    }


def _save_submission(result: DocumentResult, filename: str = "",
                     student_name: Optional[str] = None) -> str:
    try:
        doc = {
            "filename":         filename,
            "student_name":     student_name,   # FIX [MEDIUM]: now stored
            "overall_score":    result.overall_score,
            "label":            result.label,
            "confidence":       result.confidence,
            "flagged_count":    result.flagged_count,
            "total_sentences":  result.total_sentences,
            "section_scores":   result.section_scores,
            "ai_detection":     result.ai_detection,
            "source_fetch":     result.source_fetch,
            "submitted_at":     datetime.now(timezone.utc),
            "sentence_results": [_sentence_result_to_dict(r) for r in result.sentence_results],
        }
        return str(_get_submissions().insert_one(doc).inserted_id)
    except Exception:
        return ""

def _save_pairs(pairs: list[dict]) -> None:
    """Insert pairs. Always call _delete_pairs_for_students() before this."""
    global _pairs_cache
    if not pairs: return
    
    # Save to memory cache (always works)
    _pairs_cache = pairs
    
    # Try to save to MongoDB (may fail)
    try:
        _get_pairs_col().insert_many(
            [{**p, "created_at": datetime.now(timezone.utc)} for p in pairs],
            ordered=False,
        )
    except Exception as e:
        print(f"⚠️ MongoDB save failed (using in-memory cache): {e}")


def _delete_pairs_for_students(labels: list[str]) -> None:
    """
    Delete ALL existing pairs where either student_a or student_b is in
    this batch. This ensures a clean slate before inserting new results —
    no duplicate rings across multiple submissions of the same students.
    """
    if not labels: return
    try:
        _get_pairs_col().delete_many({
            "$or": [
                {"student_a": {"$in": labels}},
                {"student_b": {"$in": labels}},
            ]
        })
    except Exception:
        pass


@app.get("/stats")
def get_stats():
    try:
        return {
            "cache":  cache_stats(),
            "corpus": corpus_stats(),
            "submissions_total": _get_submissions().count_documents({}),
        }
    except Exception as e:
        return {"error": str(e)}


@app.get("/health")
def health_check():
    """Check backend and MongoDB connectivity."""
    global _pairs_cache
    try:
        db = _get_mongo_db()
        # Test connection with a simple ping
        db.command("ping")
        return {
            "status": "healthy ✓",
            "mongodb": "✓ connected",
            "pairs_in_database": _get_pairs_col().count_documents({}),
            "pairs_in_cache": len(_pairs_cache)
        }
    except Exception as e:
        return {
            "status": "degraded (using in-memory cache)",
            "mongodb": f"✗ {type(e).__name__}",
            "error": str(e),
            "pairs_in_cache": len(_pairs_cache),
            "note": "MongoDB unavailable but network visualization will work with cached data"
        }


@app.get("/pairs")
def get_pairs(threshold: float = Query(0.70)):
    """Fetch pairs for network visualization - uses memory cache as fallback."""
    global _pairs_cache
    
    # Always try memory cache first (most reliable)
    try:
        if _pairs_cache:
            filtered = [p for p in _pairs_cache if p.get("similarity", 0) >= threshold]
            filtered.sort(key=lambda p: p.get("similarity", 0), reverse=True)
            return {"pairs": filtered[:200], "count": len(filtered), "source": "memory_cache"}
    except Exception as e:
        print(f"DEBUG: Memory cache error: {e}")
    
    # Try MongoDB if cache is empty
    try:
        docs = list(
            _get_pairs_col()
              .find({"similarity": {"$gte": threshold}}, {"_id": 0})
              .sort("similarity", DESCENDING)
              .limit(200)
        )
        return {"pairs": docs, "count": len(docs), "source": "mongodb"}
    except Exception as e:
        print(f"DEBUG: MongoDB error: {e}")
        # Return empty pairs if everything fails
        return {"pairs": [], "count": 0, "source": "error", "error": str(e)}


@app.delete("/pairs")
def clear_pairs():
    """Clear all stored similarity pairs — resets the network graph."""
    result = _get_pairs_col().delete_many({})
    return {"deleted": result.deleted_count}


@app.post("/pairs")
def add_pair(body: AddPairRequest):
    """Manually add a single pair to the network database.
    
    Useful for:
    - Adding manually detected plagiarism pairs
    - Importing external comparison results
    - Testing network visualization
    """
    global _pairs_cache
    try:
        pair_doc = {
            "student_a": body.student_a,
            "student_b": body.student_b,
            "similarity": max(0.0, min(1.0, body.similarity)),  # Clamp to [0, 1]
            "flagged_sentences": max(0, body.flagged_sentences),
            "copier": body.copier or body.student_b,
            "original": body.original or body.student_a,
            "direction_confidence": body.direction_confidence or "Low",
            "direction_signals": body.direction_signals or {},
            "is_common_source": body.is_common_source,
            "submitted_a": body.submitted_a,
            "submitted_b": body.submitted_b,
            "sentence_pairs": body.sentence_pairs or [],
            "created_at": datetime.now(timezone.utc),
        }
        
        # Add to memory cache
        _pairs_cache.append(pair_doc)
        
        # Try to save to MongoDB
        try:
            result = _get_pairs_col().insert_one(pair_doc)
            return {
                "status": "success",
                "pair_id": str(result.inserted_id),
                "message": f"Pair added: {body.student_a} ↔ {body.student_b} (similarity: {body.similarity:.2%})",
                "storage": "mongodb"
            }
        except Exception as e:
            print(f"⚠️ MongoDB insert failed, using in-memory cache: {e}")
            return {
                "status": "success",
                "message": f"Pair added to cache: {body.student_a} ↔ {body.student_b} (similarity: {body.similarity:.2%})",
                "storage": "memory_cache"
            }
    except Exception as e:
        raise HTTPException(500, f"Failed to add pair: {str(e)}")


@app.post("/pairs/batch")
def add_pairs_batch(bodies: list[AddPairRequest]):
    """Bulk add multiple pairs to the network database.
    
    More efficient than calling POST /pairs multiple times.
    """
    global _pairs_cache
    try:
        if not bodies:
            raise HTTPException(400, "Need at least 1 pair to add.")
        
        pair_docs = []
        for body in bodies:
            pair_doc = {
                "student_a": body.student_a,
                "student_b": body.student_b,
                "similarity": max(0.0, min(1.0, body.similarity)),
                "flagged_sentences": max(0, body.flagged_sentences),
                "copier": body.copier or body.student_b,
                "original": body.original or body.student_a,
                "direction_confidence": body.direction_confidence or "Low",
                "direction_signals": body.direction_signals or {},
                "is_common_source": body.is_common_source,
                "submitted_a": body.submitted_a,
                "submitted_b": body.submitted_b,
                "sentence_pairs": body.sentence_pairs or [],
                "created_at": datetime.now(timezone.utc),
            }
            pair_docs.append(pair_doc)
        
        # Add to memory cache
        _pairs_cache.extend(pair_docs)
        
        # Try to save to MongoDB
        try:
            result = _get_pairs_col().insert_many(pair_docs, ordered=False)
            return {
                "status": "success",
                "inserted_count": len(result.inserted_ids),
                "message": f"Added {len(result.inserted_ids)} pairs to network database",
                "storage": "mongodb"
            }
        except Exception as e:
            print(f"⚠️ MongoDB batch insert failed, using in-memory cache: {e}")
            return {
                "status": "success",
                "inserted_count": len(pair_docs),
                "message": f"Added {len(pair_docs)} pairs to in-memory cache",
                "storage": "memory_cache"
            }
    except Exception as e:
        raise HTTPException(500, f"Failed to add pairs batch: {str(e)}")


@app.post("/cluster/batch")
def cluster_batch(body: ClusterRequest):
    if len(body.texts) < 2:
        raise HTTPException(400, "Need at least 2 student texts to cluster.")
    labels = body.labels or [f"Student {i+1}" for i in range(len(body.texts))]
    if len(labels) != len(body.texts):
        raise HTTPException(400, "texts and labels must be the same length.")
    try:
        result = detect_clusters(
            texts=body.texts, labels=labels,
            eps=body.eps, min_samples=body.min_samples,
        )
    except Exception as e:
        raise HTTPException(500, f"Clustering failed: {str(e)}")
    return cluster_result_to_dict(result)


@app.post("/feedback/sentence")
def get_sentence_feedback(body: FeedbackRequest):
    if not body.sentence.strip():
        raise HTTPException(400, "Sentence cannot be empty.")
    fb = generate_feedback(
        sentence   = body.sentence,
        label      = body.label,
        score      = body.score,
        source_url = body.source_url,
        confidence = body.confidence,
        matched_src= body.matched_src,
    )
    return feedback_to_dict(fb)


@app.post("/feedback/document")
def get_document_feedback(body: TextCheckRequest):
    if not body.text.strip():
        raise HTTPException(400, "Text cannot be empty.")
    result   = _check_text(
        body.text,
        auto_fetch_corpus=body.auto_fetch_corpus,
        corpus_sources=_validate_corpus_sources(body.sources),  # FIX [MEDIUM]: was missing
    )
    sid      = _save_submission(result, filename="[text input]", student_name=body.student_name)
    doc_dict = _doc_result_to_dict(result, sid)
    for s in doc_dict["sentences"]:
        if s["label"] != "ORIGINAL":
            fb = generate_feedback(
                sentence   = s["sentence"],
                label      = s["label"],
                score      = s["score"],
                source_url = s.get("source_url", "unknown"),
                confidence = s["confidence"],
                matched_src= s.get("matched_source", ""),
            )
            s["feedback"] = feedback_to_dict(fb)
    return doc_dict


@app.post("/detect/ai")
def detect_ai(body: AIDetectRequest):
    if not body.text.strip():
        raise HTTPException(400, "Text cannot be empty.")
    result = detect_ai_content(body.text)
    return ai_result_to_dict(result)


@app.get("/report/{submission_id}")
def download_report(submission_id: str):
    from bson import ObjectId
    try:
        oid = ObjectId(submission_id)
    except Exception:
        raise HTTPException(400, f"Invalid submission ID: {submission_id}")
    doc = _get_submissions().find_one({"_id": oid})
    if not doc:
        raise HTTPException(404, f"Submission {submission_id} not found.")
    doc["_id"]           = str(doc["_id"])
    doc["submission_id"] = doc["_id"]
    full_text = " ".join(s.get("sentence", "") for s in doc.get("sentence_results", []))
    ai_result = None
    if full_text.strip():
        ai_result = ai_result_to_dict(detect_ai_content(full_text))
    pdf_bytes = generate_report(result=doc, filename=doc.get("filename", "document"), ai_result=ai_result)
    return StreamingResponse(
        io.BytesIO(pdf_bytes), media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="report_{submission_id[:8]}.pdf"'},
    )


@app.post("/report/preview")
async def report_from_upload(
    file: UploadFile = File(...),
    auto_fetch_corpus: bool = Query(True),
):
    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in {"pdf", "docx", "txt"}:
        raise HTTPException(400, f"Unsupported: .{ext}")
    with tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}") as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    try:
        result = check_document(tmp_path, auto_fetch_corpus=auto_fetch_corpus)
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        os.unlink(tmp_path)
    sid      = _save_submission(result, filename=file.filename)
    doc_dict = _doc_result_to_dict(result, sid)
    pdf_bytes = generate_report(result=doc_dict, filename=file.filename or "document")
    return StreamingResponse(
        io.BytesIO(pdf_bytes), media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="plagiarism_report_{sid[:8]}.pdf"'},
    )