# pipeline.py
# FIX [MEDIUM]: check_text() now calls filter_cited_sentences() after tokenization.
#               Properly-cited sentences in pasted text were being flagged as plagiarism.

from detector.extractor import extract, filter_cited_sentences
from detector.embedder  import encode
from detector.corpus    import query_corpus, add_to_corpus, fetch_wikipedia, fetch_arxiv, fetch_ieee
from detector.detector  import check_sentence, aggregate, DocumentResult


def check_document(
    file_path: str,
    auto_fetch_corpus: bool = True,
    top_k_matches: int = 5,
    corpus_sources: list[str] | None = None,
) -> DocumentResult:
    print(f"\n[pipeline] Checking: {file_path}")

    extracted = extract(file_path)
    print(f"[pipeline] Extracted {extracted['sentence_count']} sentences "
          f"({extracted['word_count']} words, lang={extracted['language']})")

    to_check, skipped = filter_cited_sentences(extracted["sentences"])
    print(f"[pipeline] Checking {len(to_check)} sentences (skipping {len(skipped)} cited)")

    if not to_check:
        print("[pipeline] No sentences to check after citation filter.")
        return DocumentResult(0.0, "High", "CLEAN", 0, 0)

    selected_sources = _normalise_corpus_sources(corpus_sources, extracted["language"]) \
        if corpus_sources or auto_fetch_corpus else None
    source_fetch = _init_source_fetch(selected_sources or [])

    if auto_fetch_corpus:
        keywords = _extract_keywords(extracted["raw_text"])
        print(f"[pipeline] Auto-fetching from {selected_sources} for: {keywords}")
        for kw in keywords[:3]:
            if "wikipedia" in selected_sources:
                _merge_source_fetch(source_fetch, "wikipedia", _fetch_and_add(fetch_wikipedia, kw, lang=extracted["language"][:2]))
            if "arxiv" in selected_sources and extracted["language"] == "en":
                _merge_source_fetch(source_fetch, "arxiv", _fetch_and_add(fetch_arxiv, kw, max_papers=2))
            elif "arxiv" in selected_sources:
                _mark_source_skipped(source_fetch, "arxiv", f"Unsupported language: {extracted['language']}")
            if "ieee" in selected_sources and extracted["language"] == "en":
                _merge_source_fetch(source_fetch, "ieee", _fetch_and_add(fetch_ieee, kw, max_records=2))
            elif "ieee" in selected_sources:
                _mark_source_skipped(source_fetch, "ieee", f"Unsupported language: {extracted['language']}")

    doc_result_source_fetch = _finalise_source_fetch(source_fetch)

    try:
        from detector.cache import get_embeddings_batch
        embeddings = get_embeddings_batch(to_check, encode)
    except Exception:
        embeddings = encode(to_check)

    print("[pipeline] Running 3-layer detection cascade...")
    results = []
    for i, (sentence, embedding) in enumerate(zip(to_check, embeddings)):
        corpus_sentences, source_urls, source_names, corpus_embs = query_corpus(
            embedding, top_k=top_k_matches,
            allowed_sources=selected_sources,
        )
        if not corpus_sentences:
            from detector.detector import SentenceResult
            results.append(SentenceResult(sentence=sentence, score=0.0, label="ORIGINAL",
                confidence="High", layer_hit=0, layers_flagged=0,
                explanation="No corpus available to compare against."))
            continue
        results.append(check_sentence(
            sentence=sentence, query_embedding=embedding,
            corpus_sentences=corpus_sentences, corpus_embeddings=corpus_embs,
            corpus_sources=source_urls, corpus_source_names=source_names,
        ))
        if (i + 1) % 10 == 0:
            print(f"[pipeline]   {i+1}/{len(to_check)} checked...")

    doc_result = aggregate(results, raw_text=extracted["raw_text"], checked_sentences=to_check)
    doc_result.source_fetch = doc_result_source_fetch
    print(f"\n[pipeline] ✓ Done. Score={doc_result.overall_score}% Label={doc_result.label} "
          f"Flagged={doc_result.flagged_count}/{doc_result.total_sentences}")

    try:
        from detector.ai_detector import detect_ai_content, ai_result_to_dict
        ai_result = detect_ai_content(extracted["raw_text"])
        doc_result.ai_detection = ai_result_to_dict(ai_result)
        print(f"[pipeline]   AI label: {ai_result.label}  score={ai_result.ai_score}")
    except Exception as e:
        import traceback; traceback.print_exc()
        doc_result.ai_detection = {}

    return doc_result


def check_text(
    text: str,
    auto_fetch_corpus: bool = True,
    corpus_sources: list[str] | None = None,
) -> DocumentResult:
    import nltk
    nltk.download("punkt", quiet=True)
    nltk.download("punkt_tab", quiet=True)
    from nltk.tokenize import sent_tokenize
    from langdetect import detect

    text = text.strip()
    if not text:
        return DocumentResult(0.0, "High", "CLEAN", 0, 0)

    try:
        lang = detect(text[:2000])
    except Exception:
        lang = "en"
    fetch_lang = lang if lang in ["en", "fr", "de", "es", "hi", "pt", "it"] else "en"

    raw_sentences = [s.strip() for s in sent_tokenize(text) if len(s.split()) >= 5]
    if not raw_sentences:
        raw_sentences = [s.strip() for s in text.replace("\n"," ").split(".") if len(s.split()) >= 5]
    if not raw_sentences:
        return DocumentResult(0.0, "High", "CLEAN", 0, 0)

    # FIX [MEDIUM]: filter cited sentences — was missing, flagging properly-cited text as plagiarism
    sentences, skipped = filter_cited_sentences(raw_sentences)
    if not sentences:
        sentences = raw_sentences  # safety fallback if everything is cited
    print(f"[pipeline] check_text: {len(sentences)} sentences (skipped {len(skipped)} cited), lang={lang}")

    selected_sources = _normalise_corpus_sources(corpus_sources, fetch_lang) \
        if corpus_sources or auto_fetch_corpus else None
    source_fetch = _init_source_fetch(selected_sources or [])

    if auto_fetch_corpus:
        keywords = _extract_keywords(text)
        print(f"[pipeline] Auto-fetching from {selected_sources} for: {keywords}")
        for kw in keywords[:3]:
            if "wikipedia" in selected_sources:
                _merge_source_fetch(source_fetch, "wikipedia", _fetch_and_add(fetch_wikipedia, kw, lang=fetch_lang))
            if "arxiv" in selected_sources and fetch_lang == "en":
                _merge_source_fetch(source_fetch, "arxiv", _fetch_and_add(fetch_arxiv, kw, max_papers=2))
            elif "arxiv" in selected_sources:
                _mark_source_skipped(source_fetch, "arxiv", f"Unsupported language: {fetch_lang}")
            if "ieee" in selected_sources and fetch_lang == "en":
                _merge_source_fetch(source_fetch, "ieee", _fetch_and_add(fetch_ieee, kw, max_records=2))
            elif "ieee" in selected_sources:
                _mark_source_skipped(source_fetch, "ieee", f"Unsupported language: {fetch_lang}")

    doc_result_source_fetch = _finalise_source_fetch(source_fetch)

    try:
        from detector.cache import get_embeddings_batch
        embeddings = get_embeddings_batch(sentences, encode)
    except Exception:
        embeddings = encode(sentences)

    print("[pipeline] Running 3-layer detection cascade...")
    results = []
    for i, (sentence, embedding) in enumerate(zip(sentences, embeddings)):
        corpus_sentences, source_urls, source_names, corpus_embs = query_corpus(
            embedding, top_k=5, allowed_sources=selected_sources,
        )
        if not corpus_sentences:
            from detector.detector import SentenceResult
            results.append(SentenceResult(sentence=sentence, score=0.0, label="ORIGINAL",
                confidence="High", layer_hit=0, layers_flagged=0,
                explanation="No corpus available to compare against."))
        else:
            results.append(check_sentence(
                sentence=sentence, query_embedding=embedding,
                corpus_sentences=corpus_sentences, corpus_embeddings=corpus_embs,
                corpus_sources=source_urls, corpus_source_names=source_names,
            ))
        if (i + 1) % 10 == 0:
            print(f"[pipeline]   {i+1}/{len(sentences)} done...")

    doc_result = aggregate(results, raw_text=text, checked_sentences=sentences)
    doc_result.source_fetch = doc_result_source_fetch
    print(f"[pipeline] Done. Score={doc_result.overall_score}% Label={doc_result.label}")

    try:
        from detector.ai_detector import detect_ai_content, ai_result_to_dict
        ai_result = detect_ai_content(text)
        doc_result.ai_detection = ai_result_to_dict(ai_result)
    except Exception as e:
        import traceback; traceback.print_exc()
        doc_result.ai_detection = {}

    return doc_result


# ── Helpers ───────────────────────────────────────────────────────────────────

def _extract_keywords(text: str, n: int = 5) -> list[str]:
    import re
    from collections import Counter
    stopwords = {
        "the","a","an","and","or","but","in","on","at","to","for","of","with","by","from",
        "is","are","was","were","be","been","this","that","it","its","as","we","our","their",
        "which","can","has","have","had","will","would","also","not","they",
    }
    words = re.findall(r"\b[a-zA-Z]{4,}\b", text.lower())
    words = [w for w in words if w not in stopwords]
    return [word for word, _ in Counter(words).most_common(n * 3)[:n]]


def _normalise_corpus_sources(sources: list[str] | None, language: str) -> list[str]:
    allowed = {"wikipedia", "arxiv", "ieee", "stored"}
    chosen  = [s.lower() for s in (sources or []) if isinstance(s, str) and s.lower() in allowed]
    if not chosen:
        return ["wikipedia", "arxiv"] if language == "en" else ["wikipedia"]
    return list(dict.fromkeys(chosen))


def _fetch_and_add(fetch_fn, *args, **kwargs) -> dict:
    result = fetch_fn(*args, return_status=True, **kwargs)
    items  = result["items"]
    result["added"] = add_to_corpus(items) if items else 0
    result.pop("items", None)
    return result


def _init_source_fetch(selected_sources: list[str]) -> dict:
    return {
        "selected_sources": selected_sources,
        "sources": {
            s: {"status": "local" if s == "stored" else "pending", "fetched": 0, "added": 0, "error": None}
            for s in selected_sources
        },
        "has_errors": False,
    }


def _merge_source_fetch(source_fetch: dict, source: str, result: dict) -> None:
    current  = source_fetch["sources"][source]
    current["fetched"] += result.get("fetched", 0)
    current["added"]   += result.get("added", 0)
    priority = {"error": 6, "disabled": 5, "skipped": 4, "ok": 3, "empty": 2, "local": 1, "pending": 0}
    new_status = result.get("status", "pending")
    if priority.get(new_status, 0) >= priority.get(current.get("status", "pending"), 0):
        current["status"] = new_status
    if result.get("error"):
        current["error"] = result["error"]
        source_fetch["has_errors"] = True
    if current["status"] == "pending":
        current["status"] = "empty"


def _mark_source_skipped(source_fetch: dict, source: str, reason: str) -> None:
    current = source_fetch["sources"][source]
    if current["status"] != "error":
        current["status"] = "skipped"
    current["error"] = current["error"] or reason


def _finalise_source_fetch(source_fetch: dict) -> dict:
    for source, info in source_fetch["sources"].items():
        if info["status"] == "pending":
            info["status"] = "empty"
        if info.get("error"):
            source_fetch["has_errors"] = True
    return source_fetch