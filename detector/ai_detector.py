# detector/ai_detector.py — AI-generated content detection
#
# Model: Hello-SimpleAI/chatgpt-detector-roberta
#   Trained on ChatGPT (GPT-3.5) vs human text pairs.
#   Labels: "ChatGPT" = AI generated, "Human" = human written.
#
# Why the old version was under-sensitive:
#   1. text[:1000] truncation — missed AI sections in the middle/end of longer docs
#   2. Heuristic list was GPT-3.5 era only ("delve into", "as an AI language model")
#      GPT-4/Claude writes differently and avoided those tells
#   3. No burstiness signal — AI text has suspiciously uniform sentence lengths
#   4. Ensemble was 60% model + 40% heuristic — model often unsure on GPT-4 text
#      because it was trained on GPT-3.5 output
#
# Fixes in this version:
#   - Chunk long texts into 800-char windows, score each, take weighted max+mean
#     → catches AI sections anywhere in the document
#   - Expanded heuristic phrase list with GPT-4 / Claude era patterns
#   - Added statistical signal: type-token ratio + sentence-length burstiness
#   - Added a structure/style signal for repeated sentence openings and low-personal prose
#   - Calibrated low model scores so outdated classifier certainty does not dominate
#   - Rebalanced toward UNCERTAIN / LIKELY_HUMAN instead of overconfident HUMAN

from collections import Counter
from dataclasses import dataclass
import re

_model     = None
_available = None


@dataclass
class AIDetectionResult:
    ai_score:    float
    label:       str
    confidence:  str
    explanation: str


# ── Model loader ──────────────────────────────────────────────────────────────

def _load_model() -> bool:
    global _model, _available
    if _available is not None:
        return _available
    try:
        from transformers import pipeline
        print("[ai_detector] Loading Hello-SimpleAI/chatgpt-detector-roberta...")
        _model = pipeline(
            "text-classification",
            model="Hello-SimpleAI/chatgpt-detector-roberta",
            truncation=True,
            max_length=512,
        )
        _available = True
        print("[ai_detector] Model ready.")
    except Exception as e:
        print(f"[ai_detector] Model unavailable: {e}")
        _available = False
    return _available


# ── Heuristic scorer (expanded for GPT-4 / Claude era) ───────────────────────

def _heuristic_score(text: str) -> float:
    """Score 0–1 based on density of known AI writing patterns."""
    text_lower = text.lower()
    words      = text_lower.split()
    word_count = max(len(words), 1)

    # Strong signals — weight 2.8 each
    strong_phrases = [
        # GPT-3.5 era (original list)
        "it is worth noting", "it is important to note", "it's worth noting",
        "plays a pivotal role", "in the realm of", "in today's rapidly evolving",
        "rapidly evolving technological landscape", "delve into",
        "as an ai language model", "as a language model", "i cannot provide",
        "stakeholders alike", "unprecedented levels of", "multifaceted",
        "it's important to consider", "nuanced understanding",
        "in conclusion, it is", "in today's world",
        "tailored to individual needs", "foster a culture of",
        # GPT-4 / Claude era additions
        "i'd be happy to", "certainly! here", "of course! here",
        "certainly, here's", "sure, here's",
        "as a large language model", "as an ai assistant",
        "here's a comprehensive", "here is a comprehensive",
        "leveraging the power of", "harness the power of", "by harnessing",
        "transformative potential", "in the ever-evolving", "ever-evolving landscape",
        "at its core,", "it's worth emphasizing", "it is worth emphasizing",
        "allow me to", "let's dive into", "let's explore",
        "several key factors", "key takeaways", "to summarize the key",
        "the following key points",
    ]

    # Weak signals — weight 0.9 each
    weak_phrases = [
        "furthermore,", "moreover,", "in conclusion", "in summary",
        "additionally,", "it is crucial", "it is essential",
        "diverse domains", "a wide range of", "it is noteworthy",
        "it should be noted", "plays a crucial role", "this approach",
        "various aspects", "efficient and effective",
        # Additional weak signals
        "in this regard", "with that said", "that being said",
        "to this end", "it goes without saying", "needless to say",
        "it is imperative", "it is paramount", "going forward",
        "moving forward", "first and foremost", "last but not least",
        "in a nutshell", "to put it simply", "from a broader perspective",
    ]

    strong_hits = sum(1 for p in strong_phrases if p in text_lower)
    weak_hits   = sum(1 for p in weak_phrases   if p in text_lower)

    length_factor = word_count / 100.0
    raw_score     = (strong_hits * 2.8 + weak_hits * 0.9) / max(length_factor, 0.4)
    return round(min(raw_score / 5.5, 1.0), 4)


# ── Statistical signal: burstiness + lexical diversity ───────────────────────

def _statistical_score(text: str) -> float:
    """
    AI text tends to have:
      - Low lexical diversity (repetitive connector words, formal register)
      - Uniform sentence lengths — humans write burstier sentences

    Returns 0–1. Low burstiness / low TTR → higher AI probability.
    """
    import math
    words = text.split()
    if len(words) < 30:
        return 0.0

    # Type-token ratio — AI formal text is more repetitive
    unique_words = set(w.lower().strip('.,;:!?"\'') for w in words)
    ttr          = len(unique_words) / len(words)
    # ttr ≤ 0.40 → high AI signal; ttr ≥ 0.60 → low AI signal
    ttr_score = max(0.0, min(1.0, (0.60 - ttr) / 0.20))

    # Sentence-length coefficient of variation
    sentences = [s.strip() for s in re.split(r'[.!?]+', text) if len(s.split()) >= 3]
    if len(sentences) < 3:
        return ttr_score * 0.5

    lens   = [len(s.split()) for s in sentences]
    mean_l = sum(lens) / len(lens)
    var_l  = sum((l - mean_l) ** 2 for l in lens) / len(lens)
    cv     = math.sqrt(var_l) / max(mean_l, 1)
    # cv ≤ 0.20 → high AI signal; cv ≥ 0.55 → low AI signal
    burstiness_score = max(0.0, min(1.0, (0.55 - cv) / 0.35))

    return round(0.35 * ttr_score + 0.65 * burstiness_score, 4)


def _structure_score(text: str) -> float:
    """
    Extra signal for polished, low-variance explanatory prose.

    This should nudge borderline academic text toward UNCERTAIN rather than
    force an AI verdict on its own.
    """
    sentences = [s.strip() for s in re.split(r'[.!?]+', text) if len(s.split()) >= 4]
    if len(sentences) < 4:
        return 0.0

    openers = []
    for sentence in sentences:
        words = re.findall(r"\b[a-zA-Z']+\b", sentence.lower())
        if words:
            openers.append(" ".join(words[:2]))

    opener_counts = Counter(openers)
    repeated_openers = sum(count for count in opener_counts.values() if count > 1)
    repeated_opener_score = min(repeated_openers / max(len(openers), 1), 1.0)

    contractions = len(re.findall(r"\b\w+'\w+\b", text))
    contraction_rate = contractions / max(len(sentences), 1)
    low_contraction_score = max(0.0, min(1.0, (0.35 - contraction_rate) / 0.35))

    personal_markers = len(re.findall(r"\b(i|we|my|our|me|us)\b", text.lower()))
    personal_rate = personal_markers / max(len(sentences), 1)
    low_personal_score = max(0.0, min(1.0, (0.6 - personal_rate) / 0.6))

    connector_hits = sum(
        1
        for phrase in [
            "furthermore", "moreover", "in addition", "additionally",
            "therefore", "thus", "consequently", "in conclusion", "in summary",
        ]
        if phrase in text.lower()
    )
    connector_score = min(connector_hits / max(len(sentences) / 3, 1), 1.0)

    return round(
        0.35 * repeated_opener_score
        + 0.20 * low_contraction_score
        + 0.20 * low_personal_score
        + 0.25 * connector_score,
        4,
    )


# ── Chunk-based model scoring ─────────────────────────────────────────────────

def _model_score_chunked(text: str) -> float:
    """
    Score 800-char overlapping chunks, return weighted max+mean.

    Old approach was text[:1000] — this missed AI content in the middle/end
    of longer documents. A mixed-text doc (human intro + AI body) would score
    low because the model only ever saw the human opening paragraph.
    """
    if not _load_model():
        return 0.0

    chunk_size, overlap = 800, 200
    chunks, i = [], 0
    while i < len(text):
        chunk = text[i:i + chunk_size]
        if chunk.strip():
            chunks.append(chunk)
        i += chunk_size - overlap
        if i + overlap >= len(text):
            tail = text[i:]
            if len(tail.split()) > 10:
                chunks.append(tail)
            break

    if not chunks:
        return 0.0

    scores = []
    for chunk in chunks[:8]:   # cap at 8 chunks to limit latency
        try:
            raw   = _model(chunk)[0]
            is_ai = raw["label"].lower() in {"chatgpt", "fake", "label_1"}
            scores.append(raw["score"] if is_ai else 1.0 - raw["score"])
        except Exception:
            pass

    if not scores:
        return 0.0

    # Weighted: 65% max (catches any clearly-AI section), 35% mean (overall signal)
    return round(0.65 * max(scores) + 0.35 * (sum(scores) / len(scores)), 4)


def _calibrate_model_score(
    model_score: float,
    heuristic: float,
    statistical: float,
    structural: float,
    word_count: int,
) -> float:
    """
    The bundled classifier is old and often returns near-zero AI scores for
    polished academic prose. Treat that as weak evidence, not certainty.
    """
    if model_score >= 0.18 or word_count < 120:
        return model_score

    support = max(heuristic, statistical, structural)
    if support < 0.22:
        return model_score

    floor = min(0.28, 0.10 + support * 0.45)
    return round(max(model_score, floor), 4)


# ── Main detection ────────────────────────────────────────────────────────────

def detect_ai_content(text: str) -> AIDetectionResult:
    """
    4-signal ensemble:
      calibrated model  35%
      phrase heuristic  20%
      statistical       25%
      structure/style   20%
    """
    text = text.strip()
    if not text or len(text) < 50:
        return AIDetectionResult(0.0, "UNCERTAIN", "Low", "Text too short to analyse.")

    heuristic   = _heuristic_score(text)
    statistical = _statistical_score(text)
    structural  = _structure_score(text)
    word_count  = len(text.split())

    if _load_model():
        raw_model = _model_score_chunked(text)
        model_s   = _calibrate_model_score(raw_model, heuristic, statistical, structural, word_count)
        ai_score  = round(0.35 * model_s + 0.20 * heuristic + 0.25 * statistical + 0.20 * structural, 4)
        print(
            "[ai_detector] "
            f"model_raw={raw_model:.3f}  model_cal={model_s:.3f}  "
            f"heuristic={heuristic:.3f}  statistical={statistical:.3f}  structural={structural:.3f}  → {ai_score:.3f}"
        )
    else:
        ai_score = round(0.40 * heuristic + 0.35 * statistical + 0.25 * structural, 4)
        print(
            f"[ai_detector] (no model) heuristic={heuristic:.3f}  "
            f"statistical={statistical:.3f}  structural={structural:.3f}  → {ai_score:.3f}"
        )

    return _score_to_result(ai_score)


def detect_ai_per_sentence(sentences: list) -> list:
    return [detect_ai_content(s) if len(s.strip()) >= 30
            else AIDetectionResult(0.0, "UNCERTAIN", "Low", "Too short.")
            for s in sentences]


# ── Score → label ─────────────────────────────────────────────────────────────

def _score_to_result(ai_score: float) -> AIDetectionResult:
    ai_score  = max(0.0, min(1.0, ai_score))
    pct       = int(ai_score * 100)
    human_pct = 100 - pct

    if ai_score >= 0.72:
        return AIDetectionResult(round(ai_score, 4), "AI_GENERATED", "High",
            f"Strong signs of AI generation ({pct}%). Uniform sentence rhythm, "
            "elevated transition phrase density, and low lexical burstiness detected.")
    elif ai_score >= 0.52:
        return AIDetectionResult(round(ai_score, 4), "LIKELY_AI", "Medium",
            f"Likely AI-generated ({pct}%). Multiple LLM-style patterns detected. "
            "Could be AI-assisted or lightly edited AI output. Manual review recommended.")
    elif ai_score >= 0.24:
        return AIDetectionResult(round(ai_score, 4), "UNCERTAIN", "Low",
            f"Inconclusive ({pct}% AI probability). May be human-written, AI-assisted, "
            "or lightly edited AI output.")
    elif ai_score >= 0.10:
        return AIDetectionResult(round(ai_score, 4), "LIKELY_HUMAN", "Medium",
            f"Likely human-written ({human_pct}% human probability). "
            "Some formal phrasing present but overall style appears natural.")
    else:
        return AIDetectionResult(round(ai_score, 4), "HUMAN", "High",
            f"Appears human-written ({human_pct}% human probability). "
            "No significant AI-generation patterns detected.")


# ── Serialise ─────────────────────────────────────────────────────────────────

def ai_result_to_dict(result: AIDetectionResult) -> dict:
    return {
        "ai_score":      result.ai_score,
        "ai_percent":    int(result.ai_score * 100),
        "human_score":   round(1.0 - result.ai_score, 4),
        "human_percent": int((1.0 - result.ai_score) * 100),
        "label":         result.label,
        "confidence":    result.confidence,
        "explanation":   result.explanation,
        "model":         "Hello-SimpleAI/chatgpt-detector-roberta + heuristic + statistical + structure",
    }
