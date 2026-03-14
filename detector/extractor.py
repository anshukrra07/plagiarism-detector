# extractor.py — Extract clean text from PDF, DOCX, or TXT files
# Splits into sentences and detects language

import re
import fitz          # PyMuPDF — PDF extraction
from docx import Document
from langdetect import detect
import nltk

# Download required NLTK data on first run
nltk.download("punkt", quiet=True)
nltk.download("punkt_tab", quiet=True)
from nltk.tokenize import sent_tokenize


# ── Main entry point ──────────────────────────────────────────────────────────

def extract(file_path: str) -> dict:
    """
    Extract text from a file and return structured result.

    Returns:
        {
            "raw_text": str,
            "sentences": [str, ...],
            "language": str,         # "en", "hi", etc.
            "sentence_count": int,
            "word_count": int,
        }
    """
    ext = file_path.rsplit(".", 1)[-1].lower()

    if ext == "pdf":
        raw_text = _extract_pdf(file_path)
    elif ext == "docx":
        raw_text = _extract_docx(file_path)
    elif ext == "txt":
        raw_text = _extract_txt(file_path)
    else:
        raise ValueError(f"Unsupported file type: .{ext}. Use PDF, DOCX, or TXT.")

    raw_text  = _clean(raw_text)
    sentences = _split_sentences(raw_text)
    language  = _detect_language(raw_text)

    return {
        "raw_text":       raw_text,
        "sentences":      sentences,
        "language":       language,
        "sentence_count": len(sentences),
        "word_count":     len(raw_text.split()),
    }


# ── File readers ──────────────────────────────────────────────────────────────

def _extract_pdf(path: str) -> str:
    """Extract all text from a PDF using PyMuPDF."""
    text = []
    with fitz.open(path) as doc:
        for page in doc:
            text.append(page.get_text())
    return "\n".join(text)


def _extract_docx(path: str) -> str:
    """Extract all paragraph text from a DOCX file."""
    doc = Document(path)
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def _extract_txt(path: str) -> str:
    """Read a plain text file."""
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()


# ── Text cleaning ─────────────────────────────────────────────────────────────

def _clean(text: str) -> str:
    """
    Remove noise from extracted text:
    - Collapse multiple whitespace/newlines
    - Remove non-printable characters
    - Strip leading/trailing whitespace
    """
    text = re.sub(r"[^\S\n]+", " ", text)     # multiple spaces → single space
    text = re.sub(r"\n{3,}", "\n\n", text)     # 3+ newlines → 2 newlines
    text = re.sub(r"[^\x20-\x7E\u0900-\u097F\u0041-\u024F\n]", "", text)  # keep printable + Hindi + Latin
    return text.strip()


# ── Sentence splitting ────────────────────────────────────────────────────────

def _split_sentences(text: str) -> list[str]:
    """
    Split text into individual sentences using NLTK.
    Filters out:
    - Empty sentences
    - Very short sentences (< 5 words) — usually headers or page numbers
    - Citation-only sentences (e.g. "[1]", "(Smith, 2020)")
    """
    raw_sentences = sent_tokenize(text)
    cleaned = []
    for s in raw_sentences:
        s = s.strip()
        if not s:
            continue
        if len(s.split()) < 5:          # skip very short fragments
            continue
        if _is_citation_only(s):        # skip bare citation lines
            continue
        cleaned.append(s)
    return cleaned


def _is_citation_only(sentence: str) -> bool:
    """
    Return True if the sentence is nothing but a citation reference.
    Examples that return True:
        "[1] Smith, J. (2020)."
        "(Author, 2019, p. 45)"
    """
    citation_pattern = r"^[\[\(][\w\s,\.;:–\-]+[\]\)]\.?$"
    return bool(re.match(citation_pattern, sentence.strip()))


# ── Language detection ────────────────────────────────────────────────────────

def _detect_language(text: str) -> str:
    """
    Detect the primary language of the text.
    Returns ISO 639-1 code: "en", "hi", "fr", etc.
    Falls back to "en" if detection fails.
    """
    try:
        sample = text[:2000]    # use first 2000 chars for speed
        return detect(sample)
    except Exception:
        return "en"             # safe default


# ── Citation-aware sentence filter ───────────────────────────────────────────

def filter_cited_sentences(sentences: list[str]) -> tuple[list[str], list[str]]:
    """
    Separate sentences into:
    - to_check:  sentences that should be scanned for plagiarism
    - skip:      sentences that contain citations (likely intentional quotes)

    A sentence is skipped if it contains a citation pattern like:
        (Smith, 2020)   [1]   (Author et al., 2019)
    """
    citation_re = re.compile(
        r'(\([A-Z][a-z]+[\w\s,\.&;]*\d{4}\w?\))'   # (Author, Year)
        r'|(\[\d+\])'                                # [1]
        r'|(et al\.)',                               # et al.
        re.IGNORECASE
    )
    to_check, skip = [], []
    for s in sentences:
        if citation_re.search(s):
            skip.append(s)
        else:
            to_check.append(s)
    return to_check, skip
