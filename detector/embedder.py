# embedder.py — Generate sentence embeddings using SBERT
# Model: paraphrase-multilingual-MiniLM-L12-v2 (50+ languages, incl. Hindi)

import numpy as np
from sentence_transformers import SentenceTransformer

# ── Singleton model loader ────────────────────────────────────────────────────
# Load once, reuse everywhere. Loading takes ~5 seconds on first call.

_model = None

def get_model() -> SentenceTransformer:
    """Return the loaded SBERT model, loading it if not yet initialized."""
    global _model
    if _model is None:
        print("[embedder] Loading SBERT model (first time only, ~5s)...")
        _model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
        print("[embedder] Model ready.")
    return _model


# ── Main embedding function ───────────────────────────────────────────────────

def encode(sentences: list[str]) -> np.ndarray:
    """
    Encode a list of sentences into 384-dim embedding vectors.

    Args:
        sentences: List of sentence strings to encode.

    Returns:
        numpy array of shape (N, 384) — one vector per sentence.

    Example:
        embeddings = encode(["Machine learning improves accuracy.", "Deep learning is powerful."])
        # shape: (2, 384)
    """
    if not sentences:
        return np.array([])

    model = get_model()
    embeddings = model.encode(
        sentences,
        batch_size=32,          # encode 32 sentences at once for speed
        show_progress_bar=False,
        convert_to_numpy=True,
        normalize_embeddings=True,  # normalize → cosine sim = dot product (faster)
    )
    return embeddings


def encode_single(sentence: str) -> np.ndarray:
    """
    Encode a single sentence. Returns shape (384,).
    Convenience wrapper for cache lookups.
    """
    return encode([sentence])[0]
