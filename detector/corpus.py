# corpus.py
# FIX [HIGH]: query_corpus() with allowed_sources was doing collection.get() (fetch ALL docs)
#             + manual Python dot-product — O(N), bypasses ChromaDB HNSW index entirely.
#             Now uses native ChromaDB $in metadata filter → stays on HNSW fast path O(log N).

import os, re, time, hashlib, requests
import numpy as np
import chromadb
from dotenv import load_dotenv
from detector.embedder import encode

load_dotenv()

_client     = None
_collection = None
_ieee_disabled_reason = None

def _get_collection():
    global _client, _collection
    if _collection is None:
        _client     = chromadb.PersistentClient(path="./chroma_db")
        _collection = _client.get_or_create_collection(
            name="corpus", metadata={"hnsw:space": "cosine"},
        )
    return _collection


def fetch_wikipedia(query: str, lang: str = "en", max_sentences: int = 50, return_status: bool = False):
    headers = {"User-Agent": "PlagiarismDetector/1.0 (academic research tool; contact@example.com)"}
    search_url = f"https://{lang}.wikipedia.org/w/api.php"
    try:
        resp  = requests.get(search_url, params={"action":"query","list":"search","srsearch":query,"srlimit":1,"format":"json"}, headers=headers, timeout=15)
        resp.raise_for_status()
        title = resp.json()["query"]["search"][0]["title"]
    except Exception as e:
        print(f"[corpus] Wikipedia search failed for '{query}': {e}")
        return _fetch_result([], "error", str(e)) if return_status else []
    try:
        resp  = requests.get(search_url, params={"action":"query","prop":"extracts","exintro":False,"explaintext":True,"titles":title,"format":"json"}, headers=headers, timeout=15)
        resp.raise_for_status()
        pages = resp.json()["query"]["pages"]
        text  = next(iter(pages.values())).get("extract", "")
    except Exception as e:
        print(f"[corpus] Wikipedia extract failed for '{title}': {e}")
        return _fetch_result([], "error", str(e)) if return_status else []
    url   = f"https://{lang}.wikipedia.org/wiki/{title.replace(' ', '_')}"
    items = [{"sentence": s, "source_url": url, "source_name": f"Wikipedia: {title}", "source_type": "wikipedia"}
             for s in _split_and_clean(text)[:max_sentences]]
    return _fetch_result(items, "ok" if items else "empty") if return_status else items


def fetch_arxiv(query: str, max_papers: int = 3, max_sentences: int = 30, return_status: bool = False):
    headers = {"User-Agent": "PlagiarismDetector/1.0 (academic research tool; contact@example.com)"}
    try:
        resp = _request_with_retry(
            "https://export.arxiv.org/api/query",
            params={"search_query": f"all:{query}", "start": 0, "max_results": max_papers},
            headers=headers,
            timeout=15,
            attempts=3,
            backoff=1.0,
        )
        raw = resp.text
    except Exception as e:
        print(f"[corpus] arXiv fetch failed: {e}")
        return _fetch_result([], "error", str(e)) if return_status else []
    results = []
    for entry in re.findall(r"<entry>(.*?)</entry>", raw, re.DOTALL):
        abstract_m = re.search(r"<summary>(.*?)</summary>", entry, re.DOTALL)
        id_m       = re.search(r"<id>(.*?)</id>", entry)
        title_m    = re.search(r"<title>(.*?)</title>", entry)
        if not abstract_m: continue
        abstract    = re.sub(r"\s+", " ", abstract_m.group(1).strip())
        paper_url   = id_m.group(1).strip()    if id_m    else "https://arxiv.org"
        paper_title = title_m.group(1).strip() if title_m else "arXiv paper"
        for s in _split_and_clean(abstract)[:max_sentences]:
            results.append({"sentence": s, "source_url": paper_url, "source_name": f"arXiv: {paper_title[:60]}", "source_type": "arxiv"})
        time.sleep(0.5)
    return _fetch_result(results, "ok" if results else "empty") if return_status else results


def fetch_ieee(query: str, max_records: int = 3, max_sentences: int = 30, return_status: bool = False):
    global _ieee_disabled_reason
    api_key = os.getenv("IEEE_XPLORE_API_KEY")
    if not api_key:
        print("[corpus] IEEE Xplore skipped: IEEE_XPLORE_API_KEY is not set.")
        return _fetch_result([], "skipped", "IEEE_XPLORE_API_KEY is not set.") if return_status else []
    if _ieee_disabled_reason:
        return _fetch_result([], "disabled", _ieee_disabled_reason) if return_status else []
    try:
        resp = requests.get("https://ieeexploreapi.ieee.org/api/v1/search/articles",
                            params={"apikey": api_key, "querytext": query, "max_records": max_records, "format": "json"}, timeout=20)
        if not resp.ok:
            message = resp.text.strip()[:300] or f"HTTP {resp.status_code}"
            if resp.status_code == 403 and "developer inactive" in message.lower():
                _ieee_disabled_reason = "IEEE Xplore developer account is inactive (HTTP 403)."
                print(f"[corpus] IEEE Xplore disabled: {_ieee_disabled_reason}")
                return _fetch_result([], "disabled", _ieee_disabled_reason) if return_status else []
            raise requests.exceptions.HTTPError(message, response=resp)
        payload = resp.json()
    except Exception as e:
        print(f"[corpus] IEEE Xplore fetch failed for '{query}': {e}")
        return _fetch_result([], "error", str(e)) if return_status else []
    results = []
    for article in payload.get("articles", []):
        abstract = re.sub(r"\s+", " ", (article.get("abstract") or "").strip())
        if not abstract: continue
        num      = str(article.get("article_number", "")).strip()
        url      = (article.get("html_url") or article.get("abstract_url")
                    or (f"https://ieeexplore.ieee.org/document/{num}" if num else "https://ieeexplore.ieee.org"))
        title    = (article.get("title") or article.get("publication_title") or "IEEE Xplore article").strip()
        for s in _split_and_clean(abstract)[:max_sentences]:
            results.append({"sentence": s, "source_url": url, "source_name": f"IEEE Xplore: {title[:60]}", "source_type": "ieee"})
    return _fetch_result(results, "ok" if results else "empty") if return_status else results


def add_to_corpus(items: list[dict]) -> int:
    if not items: return 0
    collection = _get_collection()
    sentences  = [item["sentence"] for item in items]
    metadatas  = [{"source_url": item["source_url"], "source_name": item["source_name"],
                   "source_type": _canonical_source_type(
                       item.get("source_type", _infer_source_type(item["source_url"], item["source_name"]))
                   )} for item in items]
    ids = [f"corpus_{hashlib.sha256(s.encode()).hexdigest()[:16]}" for s in sentences]

    # Deduplicate within incoming batch
    unique_idx, seen_ids = [], set()
    for i, id_ in enumerate(ids):
        if id_ not in seen_ids:
            seen_ids.add(id_); unique_idx.append(i)
    if len(unique_idx) != len(ids):
        print(f"[corpus] Skipped {len(ids) - len(unique_idx)} duplicate(s) within incoming batch.")
    sentences = [sentences[i] for i in unique_idx]
    metadatas = [metadatas[i] for i in unique_idx]
    ids       = [ids[i]       for i in unique_idx]

    existing = set(collection.get(ids=ids)["ids"])
    new_mask = [i for i, id_ in enumerate(ids) if id_ not in existing]
    if not new_mask:
        print(f"[corpus] All {len(items)} items already in corpus — skipped.")
        return 0

    embeddings = encode([sentences[i] for i in new_mask])
    collection.add(
        embeddings=[embeddings[pos].tolist() for pos in range(len(new_mask))],
        documents= [sentences[i] for i in new_mask],
        metadatas= [metadatas[i] for i in new_mask],
        ids=       [ids[i]       for i in new_mask],
    )
    print(f"[corpus] Added {len(new_mask)} new sentences. Total: {collection.count()}")
    return len(new_mask)


def query_corpus(
    query_embedding: np.ndarray,
    top_k: int = 5,
    allowed_sources: list[str] | None = None,
) -> tuple[list[str], list[str], list[str], np.ndarray]:
    """Query corpus using ChromaDB's indexed metadata filter when sources are selected."""
    collection = _get_collection()
    if collection.count() == 0:
        return [], [], [], np.array([])

    n_results = min(top_k, collection.count())

    # Build where filter
    if allowed_sources:
        canonical = [_canonical_source_type(s) for s in allowed_sources]
        where = {"source_type": {"$eq": canonical[0]}} if len(canonical) == 1 \
                else {"source_type": {"$in": canonical}}
    else:
        where = None

    try:
        kwargs = dict(
            query_embeddings=[query_embedding.tolist()],
            n_results=n_results,
            include=["documents", "metadatas", "embeddings"],
        )
        if where:
            kwargs["where"] = where
        results     = collection.query(**kwargs)
        sentences   = results["documents"][0]
        source_urls = [m["source_url"]              for m in results["metadatas"][0]]
        source_names= [_display_source_name(m)      for m in results["metadatas"][0]]
        emb_matrix  = np.array(results["embeddings"][0])
        return sentences, source_urls, source_names, emb_matrix

    except Exception as e:
        if where:
            print(f"[corpus] query_corpus filtered search failed ({e}); returning no filtered matches")
            return [], [], [], np.array([])
        raise


def corpus_stats() -> dict:
    collection = _get_collection()
    return {"total_sentences": collection.count(), "collection_name": collection.name}


def _split_and_clean(text: str) -> list[str]:
    import nltk
    nltk.download("punkt", quiet=True); nltk.download("punkt_tab", quiet=True)
    from nltk.tokenize import sent_tokenize
    return [s.strip() for s in sent_tokenize(text) if len(s.split()) >= 6 and len(s) < 600]


def _infer_source_type(source_url: str, source_name: str = "") -> str:
    url_l  = (source_url  or "").lower()
    name_l = (source_name or "").lower()
    if "wikipedia.org" in url_l or name_l.startswith("wikipedia:"): return "wikipedia"
    if "arxiv.org"     in url_l or name_l.startswith("arxiv:"):     return "arxiv"
    if "ieee.org"      in url_l or name_l.startswith("ieee xplore:"): return "ieee"
    if url_l.startswith("kaggle://") or name_l.startswith("kaggle:") or name_l.startswith("database:"): return "stored"
    return "other"


def _canonical_source_type(source_type: str) -> str:
    n = (source_type or "").lower().strip()
    if n in {"stored", "kaggle", "local", "database"}: return "stored"
    return n


def _display_source_name(metadata: dict) -> str:
    source_type = _canonical_source_type(
        metadata.get("source_type", _infer_source_type(metadata.get("source_url",""), metadata.get("source_name","")))
    )
    return "Database" if source_type == "stored" else (metadata.get("source_name") or "").strip()


def _fetch_result(items: list[dict], status: str, error: str | None = None) -> dict:
    return {"items": items, "status": status, "fetched": len(items), "error": error}


def _request_with_retry(
    url: str,
    *,
    params: dict | None = None,
    headers: dict | None = None,
    timeout: int = 15,
    attempts: int = 3,
    backoff: float = 1.0,
):
    last_exc = None
    for attempt in range(1, attempts + 1):
        try:
            resp = requests.get(url, params=params, headers=headers, timeout=timeout)
            resp.raise_for_status()
            return resp
        except requests.exceptions.Timeout as exc:
            last_exc = exc
            if attempt == attempts:
                break
            time.sleep(backoff * attempt)
        except requests.exceptions.RequestException as exc:
            last_exc = exc
            if attempt == attempts:
                break
            if isinstance(exc, requests.exceptions.HTTPError):
                status = exc.response.status_code if exc.response is not None else None
                if status and status < 500 and status != 429:
                    break
            time.sleep(backoff * attempt)
    if last_exc is not None:
        if isinstance(last_exc, requests.exceptions.Timeout):
            raise requests.exceptions.Timeout(
                f"Timed out after {attempts} attempts for {url}"
            ) from last_exc
        raise last_exc
    raise RuntimeError(f"Request failed: {url}")