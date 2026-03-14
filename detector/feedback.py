# feedback.py — AI-assisted student feedback
#
# For each flagged sentence, generates:
#   1. flag_reason  — why it was flagged (plain English)
#   2. rewrite_citation — sentence + citation placeholder
#   3. rewrite_rephrase — restructured version expressing same idea
#   4. tip          — what original insight the student should add
#
# Uses rule-based approach (no extra model needed).
# Can be upgraded to LLM-powered by swapping _generate_llm_feedback().

import re
from dataclasses import dataclass


@dataclass
class SentenceFeedback:
    original:          str
    flag_reason:       str
    rewrite_citation:  str   # "Same idea + (Author, Year)."
    rewrite_rephrase:  str   # restructured sentence
    tip:               str   # what to add to make it original
    label:             str   # EXACT | SEMANTIC | PARAPHRASE
    confidence:        str   # High | Medium | Low
    source:            str   # matched source URL or name


# ── Main entry point ──────────────────────────────────────────────────────────

def generate_feedback(
    sentence:    str,
    label:       str,
    score:       float,
    source_url:  str,
    confidence:  str,
    matched_src: str = "",
) -> SentenceFeedback:
    """
    Generate structured feedback for a flagged sentence.

    Args:
        sentence:    the student's original flagged sentence
        label:       EXACT | SEMANTIC | PARAPHRASE
        score:       similarity score 0.0–1.0
        source_url:  URL of the matched source
        confidence:  High | Medium | Low
        matched_src: the actual matched sentence from corpus (optional)
    """
    pct        = int(score * 100)
    short_src  = _shorten_url(source_url)
    clean      = sentence.rstrip('.').rstrip(',').strip()

    flag_reason       = _build_flag_reason(label, pct, short_src, confidence)
    rewrite_citation  = _build_citation_rewrite(clean, short_src)
    rewrite_rephrase  = _build_rephrase(clean, label)
    tip               = _build_tip(label, matched_src)

    return SentenceFeedback(
        original         = sentence,
        flag_reason      = flag_reason,
        rewrite_citation = rewrite_citation,
        rewrite_rephrase = rewrite_rephrase,
        tip              = tip,
        label            = label,
        confidence       = confidence,
        source           = short_src,
    )


# ── Reason builder ────────────────────────────────────────────────────────────

def _build_flag_reason(label: str, pct: int, source: str, confidence: str) -> str:
    base = {
        "EXACT":      f"This sentence is {pct}% identical to content found in {source}. "
                      f"It appears to be a direct copy with minimal or no modification.",
        "SEMANTIC":   f"This sentence is semantically {pct}% similar to {source}. "
                      f"The wording differs but the idea is too close to the source.",
        "PARAPHRASE": f"This sentence was flagged as a deep paraphrase ({pct}% similarity) of {source}. "
                      f"Even though the words differ, the underlying meaning matches closely.",
    }.get(label, f"Similarity detected ({pct}%) with {source}.")

    conf_note = {
        "High":   " The system is highly confident in this flag.",
        "Medium": " Manual review is recommended.",
        "Low":    " This flag has low confidence — it may be coincidental phrasing.",
    }.get(confidence, "")

    return base + conf_note


# ── Rewrite: add citation ─────────────────────────────────────────────────────

def _build_citation_rewrite(clean_sentence: str, source: str) -> str:
    """Wrap the sentence with a citation placeholder."""
    # If sentence already ends with a citation pattern, don't double-up
    if re.search(r'\(\w+,?\s*\d{4}\)', clean_sentence):
        return clean_sentence + "."

    # Try to extract a domain name for the citation placeholder
    domain = re.sub(r'https?://(www\.)?', '', source).split('/')[0]
    domain = domain.split('.')[0].capitalize() if domain else "Source"

    return f"{clean_sentence} ({domain}, Year)."


# ── Rewrite: rephrase ─────────────────────────────────────────────────────────

def _build_rephrase(clean_sentence: str, label: str) -> str:
    """
    Generate a rephrased version using structural transformations.
    Rules:
    - EXACT: lead with "According to research, ..."
    - SEMANTIC: flip subject/object, add hedging
    - PARAPHRASE: add contrast or qualification
    """
    words  = clean_sentence.split()
    n      = len(words)

    if label == "EXACT":
        return f"According to existing research, {clean_sentence[0].lower()}{clean_sentence[1:]}."

    if label == "SEMANTIC":
        # Try to restructure: "X does Y" → "Y can be achieved through X"
        starters = [
            "From a technical perspective, ",
            "In practice, ",
            "It has been established that ",
            "Research suggests that ",
        ]
        # Pick starter based on sentence length for variety
        starter = starters[n % len(starters)]
        lowered = clean_sentence[0].lower() + clean_sentence[1:]
        return f"{starter}{lowered}."

    if label == "PARAPHRASE":
        return (
            f"While {clean_sentence[0].lower()}{clean_sentence[1:]}, "
            f"further nuance can be added by considering [your own analysis here]."
        )

    return f"Consider rephrasing: {clean_sentence}."


# ── Tip builder ───────────────────────────────────────────────────────────────

def _build_tip(label: str, matched_src: str) -> str:
    tips = {
        "EXACT": (
            "Replace the copied text with your own explanation. "
            "If you want to reference this idea, quote it directly with quotation marks and a citation, "
            "or paraphrase it substantially in your own words."
        ),
        "SEMANTIC": (
            "Add your own perspective, experiment result, or contrast with another approach. "
            "For example: 'Unlike [X], my approach achieves [Y] by [Z].' "
            "This shows original thinking rather than restating existing knowledge."
        ),
        "PARAPHRASE": (
            "Your sentence expresses the same core idea as the source. "
            "Try adding a specific example, a number, or a limitation "
            "that is not present in the original source."
        ),
    }
    return tips.get(label, "Rephrase using your own words and add a citation.")


# ── URL shortener ─────────────────────────────────────────────────────────────

def _shorten_url(url: str) -> str:
    if not url or url == "unknown":
        return "an external source"
    domain = re.sub(r'https?://(www\.)?', '', url).split('/')[0]
    return domain or url


# ── Serialise ─────────────────────────────────────────────────────────────────

def feedback_to_dict(fb: SentenceFeedback) -> dict:
    return {
        "original":          fb.original,
        "flag_reason":       fb.flag_reason,
        "rewrite_citation":  fb.rewrite_citation,
        "rewrite_rephrase":  fb.rewrite_rephrase,
        "tip":               fb.tip,
        "label":             fb.label,
        "confidence":        fb.confidence,
        "source":            fb.source,
    }