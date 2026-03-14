"""
Seed the plagiarism corpus from a Kaggle CSV dataset and optionally run a test check.

Examples:
  ./venv/bin/python test_engine.py
  ./venv/bin/python test_engine.py --limit 100
  ./venv/bin/python test_engine.py --csv /path/to/data.csv --text-column student_answer
  ./venv/bin/python test_engine.py --check-text "Paste a student paragraph here"
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

import pandas as pd

from detector.corpus import add_to_corpus
from detector.pipeline import check_text

DEFAULT_CSV = None  # FIX [LOW]: was hardcoded to /Users/anshu/... — use --csv flag instead

TEXT_COLUMN_CANDIDATES = [
    "assignment_text",
    "student_answer",
    "text",
    "answer",
    "content",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed corpus from a Kaggle plagiarism dataset.")
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV, help="Path to Kaggle CSV file.")
    parser.add_argument("--text-column", help="Column containing student text.")
    parser.add_argument("--label-column", help="Optional column used in source labels.")
    parser.add_argument("--limit", type=int, default=0, help="Optional row limit for faster tests.")
    parser.add_argument("--min-words", type=int, default=6, help="Minimum words per sentence kept in corpus.")
    parser.add_argument(
        "--check-text",
        help="Optional text to run through the plagiarism pipeline after seeding the corpus.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.csv is None:
        raise SystemExit(
            "No CSV file specified. Pass --csv /path/to/dataset.csv\n"
            "Example: python test_engine.py --csv ./data/academic_misconduct.csv --limit 200"
        )

    csv_path = args.csv.expanduser()

    if not csv_path.exists():
        raise SystemExit(f"CSV not found: {csv_path}")

    print(f"[test_engine] Loading dataset: {csv_path}")
    df = pd.read_csv(csv_path)
    print(f"[test_engine] Rows loaded: {len(df)}")

    text_column = args.text_column or detect_text_column(df)
    label_column = args.label_column if args.label_column in df.columns else None

    print(f"[test_engine] Text column: {text_column}")
    if label_column:
        print(f"[test_engine] Label column: {label_column}")

    if args.limit > 0:
        df = df.head(args.limit)
        print(f"[test_engine] Using first {len(df)} rows")

    items = build_corpus_items(
        df=df,
        text_column=text_column,
        label_column=label_column,
        min_words=args.min_words,
        dataset_name=csv_path.stem,
    )

    print(f"[test_engine] Sentences prepared for corpus: {len(items)}")
    added = add_to_corpus(items)
    print(f"[test_engine] New corpus sentences added: {added}")

    if args.check_text:
        print("[test_engine] Running sample plagiarism check...")
        result = check_text(args.check_text, auto_fetch_corpus=False)
        print(f"[test_engine] Overall score: {result.overall_score}%")
        print(f"[test_engine] Label: {result.label}")
        print(f"[test_engine] Flagged: {result.flagged_count}/{result.total_sentences}")
        if result.sentence_results:
            top = sorted(result.sentence_results, key=lambda r: r.score, reverse=True)[:5]
            print("[test_engine] Top matches:")
            for row in top:
                print(f"  - {row.label:10} {row.score:.3f}  {row.source_url or 'unknown'}")


def detect_text_column(df: pd.DataFrame) -> str:
    for candidate in TEXT_COLUMN_CANDIDATES:
        if candidate in df.columns:
            return candidate
    raise SystemExit(
        "Could not detect a text column. Pass --text-column explicitly. "
        f"Available columns: {', '.join(df.columns)}"
    )


def build_corpus_items(
    df: pd.DataFrame,
    text_column: str,
    label_column: str | None,
    min_words: int,
    dataset_name: str,
) -> list[dict]:
    items: list[dict] = []

    for idx, row in df.iterrows():
        text = str(row.get(text_column, "") or "").strip()
        if not text or text.lower() == "nan":
            continue

        label_value = str(row.get(label_column, "")).strip() if label_column else ""
        source_name = "Database"
        if label_value and label_value.lower() != "nan":
            source_name = "Database"

        source_url = f"kaggle://{dataset_name}/row/{idx}"
        for sentence in split_sentences(text, min_words=min_words):
            items.append({
                "sentence": sentence,
                "source_url": source_url,
                "source_name": source_name,
                "source_type": "stored",
            })

    return items


def split_sentences(text: str, min_words: int) -> list[str]:
    try:
        import nltk

        nltk.download("punkt", quiet=True)
        nltk.download("punkt_tab", quiet=True)
        from nltk.tokenize import sent_tokenize

        candidates = sent_tokenize(text)
    except Exception:
        candidates = re.split(r"(?<=[.!?])\s+", text)

    cleaned = []
    for sentence in candidates:
        sentence = re.sub(r"\s+", " ", sentence).strip()
        if len(sentence.split()) >= min_words:
            cleaned.append(sentence)
    return cleaned


if __name__ == "__main__":
    main()