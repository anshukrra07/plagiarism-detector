# detector.py — 3-Layer Plagiarism Detection Cascade
#
# Layer 1: Exact/near-exact match     (TF-IDF cosine)     → threshold > 0.95
# Layer 2: Semantic similarity        (SBERT cosine)      → threshold > 0.70
# Layer 3: Paraphrase via NLI         (BERT entailment)   → runs in 0.40–0.70 zone

import numpy as np
import re
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from transformers import pipeline
from dataclasses import dataclass, field


# ── Result dataclasses ────────────────────────────────────────────────────────

@dataclass
class SentenceResult:
    sentence:           str
    score:              float
    label:              str    # "EXACT" | "SEMANTIC" | "PARAPHRASE" | "ORIGINAL"
    confidence:         str    # "High" | "Medium" | "Low"
    layer_hit:          int
    layers_flagged:     int
    matched_source:     str = ""
    source_name:        str = ""
    source_url:         str = ""
    source_credibility: str = ""
    explanation:        str = ""


@dataclass
class DocumentResult:
    overall_score:    float
    confidence:       str
    label:            str
    flagged_count:    int
    total_sentences:  int
    sentence_results: list[SentenceResult] = field(default_factory=list)
    section_scores:   dict                 = field(default_factory=dict)
    ai_detection:     dict                 = field(default_factory=dict)
    source_fetch:     dict                 = field(default_factory=dict)


# ── NLI model (Layer 3) — loaded lazily ──────────────────────────────────────

_nli_pipe = None

def _get_nli():
    global _nli_pipe
    if _nli_pipe is None:
        print("[detector] Loading NLI model for Layer 3 (first time only)...")
        _nli_pipe = pipeline(
            "zero-shot-classification",
            model="cross-encoder/nli-MiniLM2-L6-H768",
            device=-1,
        )
        print("[detector] NLI model ready.")
    return _nli_pipe


# ── Source credibility ────────────────────────────────────────────────────────

_HIGH_CRED   = {"arxiv.org", "ieee.org", "acm.org", "ncbi.nlm.nih.gov",
                "scholar.google.com", "nature.com", "science.org", "springer.com"}
_MEDIUM_CRED = {"wikipedia.org", "britannica.com", "bbc.com", "nytimes.com",
                "reuters.com", "theguardian.com"}

def _credibility(url: str) -> str:
    url = url.lower()
    # FIX [LOW]: stored/local corpus entries (kaggle://, stored://) were returning "Low"
    # which is misleading — they are internal reference data, not low-quality web sources
    if url.startswith("kaggle://") or url.startswith("stored://"):
        return "Medium"
    if any(h in url for h in _HIGH_CRED):   return "High"
    if any(m in url for m in _MEDIUM_CRED) or ".edu" in url: return "Medium"
    return "Low"


# ── Confidence from layer agreement ──────────────────────────────────────────

def _confidence(layers_flagged: int) -> str:
    if layers_flagged >= 3: return "High"
    if layers_flagged == 2: return "Medium"
    return "Low"


# ── Explanation generator ─────────────────────────────────────────────────────

def _explain(label: str, score: float, source: str, credibility: str) -> str:
    pct = int(score * 100)
    if label == "EXACT":
        return (f"Direct copy detected ({pct}% match). "
                f"This sentence appears nearly word-for-word in: {source} [{credibility} credibility].")
    if label == "SEMANTIC":
        return (f"Same idea expressed with different words ({pct}% semantic similarity). "
                f"Closely mirrors content from: {source} [{credibility} credibility]. "
                f"Reword or add a citation.")
    if label == "PARAPHRASE":
        return (f"Deep paraphrase detected ({pct}% similarity). "
                f"The meaning matches a source even though wording differs: "
                f"{source} [{credibility} credibility]. Add a citation or rewrite.")
    return "No significant similarity detected."


# ── Layer implementations ─────────────────────────────────────────────────────

def _layer1_score(sentence: str, corpus_sentences: list[str]) -> tuple[float, int]:
    if not corpus_sentences:
        return 0.0, -1
    try:
        tfidf    = TfidfVectorizer(ngram_range=(1, 2)).fit_transform([sentence] + corpus_sentences)
        scores   = cosine_similarity(tfidf[0:1], tfidf[1:]).flatten()
        best_idx = int(np.argmax(scores))
        return float(scores[best_idx]), best_idx
    except Exception:
        return 0.0, -1


def _layer2_score(query_emb: np.ndarray, corpus_embs: np.ndarray) -> tuple[float, int]:
    if corpus_embs.size == 0:
        return 0.0, -1
    scores   = corpus_embs @ query_emb
    best_idx = int(np.argmax(scores))
    return float(scores[best_idx]), best_idx


def _layer3_score(sentence: str, matched_sentence: str) -> float:
    try:
        nli    = _get_nli()
        result = nli(
            sentence,
            candidate_labels=["paraphrase", "unrelated"],
            hypothesis_template="This text is a {} of: " + matched_sentence,
        )
        idx = result["labels"].index("paraphrase")
        return float(result["scores"][idx])
    except Exception:
        return 0.0


# ── Main cascade ──────────────────────────────────────────────────────────────

def check_sentence(
    sentence:          str,
    query_embedding:   np.ndarray,
    corpus_sentences:  list[str],
    corpus_embeddings: np.ndarray,
    corpus_sources:    list[str] | None = None,
    corpus_source_names: list[str] | None = None,
) -> SentenceResult:

    sources        = corpus_sources or ["unknown"] * len(corpus_sentences)
    source_names   = corpus_source_names or [""] * len(corpus_sentences)
    layers_flagged = 0

    # ── Layer 1: Exact match ──────────────────────────────────────────────────
    l1_score, l1_idx = _layer1_score(sentence, corpus_sentences)

    if l1_score > 0.95:
        layers_flagged += 1
        matched = corpus_sentences[l1_idx]
        src_url = sources[l1_idx]
        src_name = source_names[l1_idx]
        cred    = _credibility(src_url)
        l2_score, _ = _layer2_score(query_embedding, corpus_embeddings)
        if l2_score > 0.70:
            layers_flagged += 1
        return SentenceResult(
            sentence=sentence, score=l1_score, label="EXACT",
            confidence=_confidence(layers_flagged), layer_hit=1,
            layers_flagged=layers_flagged, matched_source=matched,
            source_name=src_name,
            source_url=src_url, source_credibility=cred,
            explanation=_explain("EXACT", l1_score, src_name or src_url, cred),
        )

    # ── Layer 2: Semantic similarity ──────────────────────────────────────────
    l2_score, l2_idx = _layer2_score(query_embedding, corpus_embeddings)

    if l2_score > 0.70:
        layers_flagged += 1
        # FIX: very high semantic score (>0.85) means TF-IDF would also agree —
        # count as second-layer confirmation so confidence isn't stuck at Low.
        # Removed the old buggy "if l1_score > 0.40: layers_flagged += 1" here.
        if l2_score > 0.85:
            layers_flagged += 1

        matched = corpus_sentences[l2_idx]
        src_url = sources[l2_idx]
        src_name = source_names[l2_idx]
        cred    = _credibility(src_url)
        return SentenceResult(
            sentence=sentence, score=l2_score, label="SEMANTIC",
            confidence=_confidence(layers_flagged), layer_hit=2,
            layers_flagged=layers_flagged, matched_source=matched,
            source_name=src_name,
            source_url=src_url, source_credibility=cred,
            explanation=_explain("SEMANTIC", l2_score, src_name or src_url, cred),
        )

    # ── Layer 3: NLI — only in ambiguous 0.40–0.70 zone ──────────────────────
    if 0.40 <= l2_score <= 0.70:
        matched  = corpus_sentences[l2_idx]
        src_url  = sources[l2_idx]
        src_name = source_names[l2_idx]
        l3_score = _layer3_score(sentence, matched)

        if l3_score > 0.65:
            layers_flagged += 1
            cred = _credibility(src_url)
            return SentenceResult(
                sentence=sentence, score=l2_score, label="PARAPHRASE",
                confidence=_confidence(layers_flagged), layer_hit=3,
                layers_flagged=layers_flagged, matched_source=matched,
                source_name=src_name,
                source_url=src_url, source_credibility=cred,
                explanation=_explain("PARAPHRASE", l2_score, src_name or src_url, cred),
            )

    # ── No match ──────────────────────────────────────────────────────────────
    return SentenceResult(
        sentence=sentence, score=l2_score, label="ORIGINAL",
        confidence="High", layer_hit=0, layers_flagged=0,
        explanation="No significant similarity detected.",
    )


# ── Section scoring ───────────────────────────────────────────────────────────

_SECTION_PATTERNS = {
    "Abstract": [
        "abstract",
        "executive summary",
    ],
    "Introduction": [
        "introduction",
        "background",
        "overview",
        "motivation",
        "problem statement",
    ],
    "Literature Review": [
        "literature review",
        "related work",
        "prior work",
        "previous work",
        "review of literature",
        "survey",
    ],
    "Methodology": [
        "methodology",
        "methods",
        "materials and methods",
        "approach",
        "proposed method",
        "implementation",
        "system design",
        "model architecture",
    ],
    "Results & Discussion": [
        "results",
        "experiments",
        "evaluation",
        "performance",
        "analysis",
        "discussion",
        "findings",
    ],
    "Conclusion": [
        "conclusion",
        "conclusions",
        "summary",
        "future work",
        "limitations",
    ],
}

_SECTION_WEIGHTS = {
    "EXACT": 1.00,
    "SEMANTIC": 0.85,
    "PARAPHRASE": 0.70,
    "ORIGINAL": 0.00,
}


def compute_section_scores(
    sentence_results: list[SentenceResult],
    raw_text: str = "",
    checked_sentences: list[str] | None = None,
) -> dict:
    if not sentence_results:
        return {}

    source_sentences = checked_sentences or [r.sentence for r in sentence_results]
    assigned_sections = _assign_sentences_to_sections(raw_text, source_sentences)

    sections: dict[str, dict[str, float]] = {}
    for i, result in enumerate(sentence_results):
        section = assigned_sections[i] if i < len(assigned_sections) else _fallback_sentence_section(result.sentence)
        bucket = sections.setdefault(section, {"total_weight": 0.0, "flagged_weight": 0.0})

        word_weight = max(len(result.sentence.split()), 1)
        severity = _SECTION_WEIGHTS.get(result.label, 0.0)

        bucket["total_weight"] += word_weight
        bucket["flagged_weight"] += word_weight * severity * max(0.0, min(1.0, result.score))

    return {
        sec: round((vals["flagged_weight"] / vals["total_weight"]) * 100, 1)
        for sec, vals in sections.items()
        if vals["total_weight"] > 0
    }


# ── Document aggregation ──────────────────────────────────────────────────────

def aggregate(
    sentence_results: list[SentenceResult],
    raw_text: str = "",
    checked_sentences: list[str] | None = None,
) -> DocumentResult:
    total    = len(sentence_results)
    flagged  = [r for r in sentence_results if r.label != "ORIGINAL"]
    n_flagged = len(flagged)

    if total == 0:
        return DocumentResult(0.0, "High", "ORIGINAL", 0, 0)

    overall  = round((n_flagged / total) * 100, 1)
    conf_map = {"High": 3, "Medium": 2, "Low": 1}

    if flagged:
        avg_conf       = sum(conf_map[r.confidence] for r in flagged) / len(flagged)
        doc_confidence = "High" if avg_conf >= 2.5 else "Medium" if avg_conf >= 1.5 else "Low"
    else:
        doc_confidence = "High"

    label = (
        "HIGH_RISK"   if overall > 50 else
        "MEDIUM_RISK" if overall > 20 else
        "LOW_RISK"    if overall > 5  else
        "CLEAN"
    )

    return DocumentResult(
        overall_score=overall,
        confidence=doc_confidence,
        label=label,
        flagged_count=n_flagged,
        total_sentences=total,
        sentence_results=sentence_results,
        section_scores=compute_section_scores(sentence_results, raw_text, checked_sentences),
    )


def _assign_sentences_to_sections(raw_text: str, sentences: list[str]) -> list[str]:
    markers = _extract_section_markers(raw_text)
    if not markers:
        return [_fallback_sentence_section(sentence) for sentence in sentences]

    positions = _locate_sentence_positions(raw_text, sentences)
    return [_section_for_position(pos, markers, sentence) for pos, sentence in zip(positions, sentences)]


def _extract_section_markers(raw_text: str) -> list[tuple[int, str]]:
    markers = []
    cursor = 0
    for line in raw_text.splitlines():
        stripped = line.strip()
        if stripped:
            section = _canonical_section_heading(stripped)
            if section and _looks_like_heading(stripped):
                line_pos = raw_text.find(stripped, cursor)
                markers.append((line_pos if line_pos >= 0 else cursor, section))
        cursor += len(line) + 1

    deduped = []
    seen = set()
    for pos, name in markers:
        key = (pos, name)
        if key not in seen:
            deduped.append((pos, name))
            seen.add(key)
    return deduped


def _locate_sentence_positions(raw_text: str, sentences: list[str]) -> list[int]:
    positions = []
    cursor = 0
    for sentence in sentences:
        pos = raw_text.find(sentence, cursor)
        if pos < 0:
            compact = re.sub(r"\s+", " ", sentence).strip()
            pos = raw_text.find(compact[: min(len(compact), 120)], cursor)
        if pos < 0:
            pos = raw_text.find(sentence)
        if pos >= 0:
            cursor = pos + max(len(sentence) // 2, 1)
        positions.append(pos)
    return positions


def _section_for_position(position: int, markers: list[tuple[int, str]], sentence: str) -> str:
    if position < 0:
        return _fallback_sentence_section(sentence)

    current = "Other"
    for marker_pos, name in markers:
        if marker_pos <= position:
            current = name
        else:
            break
    return current


def _looks_like_heading(text: str) -> bool:
    stripped = text.strip().rstrip(":")
    words = stripped.split()
    if not words or len(words) > 10 or len(stripped) > 90:
        return False
    if stripped.endswith((".", "?", "!")) and len(words) > 4:
        return False

    has_numbering = bool(re.match(r"^((\d+(\.\d+)*)|[IVXLC]+)[\.\)]?\s+", stripped, re.IGNORECASE))
    alpha_words = [w for w in words if re.search(r"[A-Za-z]", w)]
    titleish = sum(1 for w in alpha_words if w[:1].isupper() or w.isupper()) >= max(1, int(len(alpha_words) * 0.6))
    return has_numbering or titleish or len(words) <= 3


def _canonical_section_heading(text: str) -> str | None:
    normalized = text.lower().strip()
    normalized = re.sub(r"^((\d+(\.\d+)*)|[ivxlc]+)[\.\)]?\s+", "", normalized)
    normalized = re.sub(r"[^a-z&/\-\s]", "", normalized).strip()

    for section, patterns in _SECTION_PATTERNS.items():
        if any(pattern in normalized for pattern in patterns):
            return section
    return None


def _fallback_sentence_section(sentence: str) -> str:
    text = sentence.lower()
    for section, patterns in _SECTION_PATTERNS.items():
        if any(pattern in text for pattern in patterns):
            return section
    return "Other"