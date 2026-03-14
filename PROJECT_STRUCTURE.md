# Project Structure

This document explains what each main folder and file in this repository does. It is intended as a quick handoff note for someone who needs to understand the project without reading the full codebase.

## Overview

This project is a plagiarism-detection platform with:

- a FastAPI backend in `api/`
- the core analysis logic in `detector/`
- a React frontend in `frontend/`
- ChromaDB for the reference corpus
- MongoDB for submissions, pair results, and embedding cache
- selectable reference sources: Wikipedia, arXiv, IEEE Xplore, and locally stored corpus data shown as `Database`
- environment-based deployment configuration for local and hosted setups

At a high level, a user submits text or a file, the backend extracts and analyzes it, and the frontend renders plagiarism results, AI-detection output, feedback suggestions, and network visualizations.
The app can compare against live-fetched web sources and also against locally stored reference data already present in ChromaDB.

## Simplified Tree

```text
plagiarism_detector/
├── api/
│   ├── __init__.py
│   └── main.py
├── detector/
│   ├── ai_detector.py
│   ├── cache.py
│   ├── cluster.py
│   ├── corpus.py
│   ├── detector.py
│   ├── embedder.py
│   ├── extractor.py
│   ├── feedback.py
│   ├── pipeline.py
│   └── report_generator.py
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   │   ├── AIBadge.jsx
│   │   │   ├── FeedbackPanel.jsx
│   │   │   ├── HighlightedDocument.jsx
│   │   │   ├── NetworkGraph.jsx
│   │   │   ├── ScoreSummary.jsx
│   │   │   ├── SectionHeatmap.jsx
│   │   │   ├── SentenceList.jsx
│   │   │   ├── SideBySideView.jsx
│   │   │   ├── SourceFetchStatus.jsx
│   │   │   └── UploadForm.jsx
│   │   ├── App.jsx
│   │   ├── api.js
│   │   ├── index.js
│   │   ├── App.css
│   │   ├── index.css
│   │   ├── reportWebVitals.js
│   │   ├── setupTests.js
│   │   └── utils/
│   │       └── sourceDisplay.js
│   ├── package.json
│   ├── package-lock.json
│   └── README.md
├── chroma_db/
├── venv/
├── .env
├── .env.example
├── DEPLOYMENT.md
├── clean_dataset.py
├── debug_ai.py
├── requirements.txt
├── test_engine.py
├── text.py
└── PROJECT_STRUCTURE.md
```

## Main Folders

### `api/`

HTTP API layer built with FastAPI.

- `main.py`
  Main backend entrypoint.
  Handles:
  - `/check/text` and `/check/file` for plagiarism analysis
  - `/compare/batch` for multi-student similarity comparison
  - `/cluster/batch` for collaboration-ring detection
  - `/feedback/sentence` and `/feedback/document` for rewrite suggestions
  - `/detect/ai` for standalone AI-generated text checks
  - `/report/{submission_id}` and `/report/preview` for PDF reports
  - `/stats`, `/pairs`, `/submissions`, and `/submissions/{submission_id}` for system and history data

Also manages MongoDB access for:

- saved submissions
- pairwise similarity records
- runtime stats lookups

It also:

- validates selectable reference sources (`wikipedia`, `arxiv`, `ieee`)
- validates local corpus selection through `stored`
- serializes `source_name` and `source_fetch` in responses so the frontend can show readable source labels and fetch diagnostics
- stores optional `student_name` with submissions
- returns source-fetch diagnostics for each check
- loads deployment configuration from environment variables

### `detector/`

Core analysis engine.

- `pipeline.py`
  Main orchestration module.
  Runs the full end-to-end check:
  - extract text
  - split into sentences
  - filter cited sentences
  - fetch/query the selected corpus sources
  - embed sentences
  - run the 3-layer plagiarism detector
  - aggregate document-level results
  - run AI-generated text detection

It also tracks per-source fetch status so failed source lookups can be shown in the UI instead of silently looking like clean plagiarism results.

- `extractor.py`
  File parsing layer for PDF, DOCX, and TXT.
  Extracts raw text, detects language, and tokenizes into sentences.

- `embedder.py`
  Loads the multilingual SBERT model and converts sentences into dense embeddings.

- `corpus.py`
  Builds and queries the external reference corpus.
  Uses Wikipedia, arXiv, IEEE Xplore, and locally seeded corpus entries as source material and stores sentence embeddings in ChromaDB.

It is responsible for:

- fetching source content
- splitting source text into corpus sentences
- storing source metadata such as `source_url`, `source_name`, and `source_type`
- filtering retrieval by selected source
- normalizing stored/Kaggle matches so the UI can display them as `Database`
- retrying transient source fetch failures such as arXiv timeouts
- disabling IEEE fetches for the current process if IEEE returns `Developer Inactive`
- reporting fetch failures such as missing IEEE credentials or API/network errors

- `detector.py`
  Core plagiarism logic.
  Implements the 3-layer detection cascade:
  - Layer 1: TF-IDF exact or near-exact overlap
  - Layer 2: semantic similarity using embeddings
  - Layer 3: paraphrase detection using NLI

  It also defines the result data structures used across the backend:
  - `SentenceResult`
  - `DocumentResult`

  It now computes section-level plagiarism using heading-aware document structure when possible, with a fallback heuristic when no headings are found.

- `cache.py`
  Embedding cache backed by MongoDB.
  Avoids recomputing embeddings for repeated sentences.

- `cluster.py`
  Batch semantic clustering logic using DBSCAN.
  Used to identify groups of students with suspiciously similar submissions.

- `feedback.py`
  Generates rewrite guidance for flagged sentences.
  Produces:
  - why the sentence was flagged
  - a citation-friendly rewrite
  - a rephrased rewrite
  - a tip for making the writing more original

- `report_generator.py`
  Builds downloadable PDF reports with summary metrics, flagged sentences, source links, and AI-detection output.

- `ai_detector.py`
  AI-generated text detector.
  Current version uses a multi-signal approach:
  - `Hello-SimpleAI/chatgpt-detector-roberta` classifier
  - phrase-pattern heuristic scoring
  - statistical signals such as lexical diversity and sentence-length burstiness
  - a structure/style signal based on repeated sentence openings and low-personal prose

  It also chunks longer texts, calibrates overly-low model scores from the older classifier, and combines signals across chunks so the detector is not limited to the first paragraph.

### `frontend/`

React client application.

- `src/App.jsx`
  Main screen composition.
  Controls:
  - top-level navigation tabs
  - upload flow
  - result rendering
  - highlighted view vs sentence-card view vs side-by-side view
  - source-fetch status rendering
  - stats page
  - network graph page

  It also injects the global visual theme once and now handles stats-load failures more gracefully.

- `src/api.js`
  Frontend API wrapper around the backend.
  Includes helpers for:
  - plagiarism checks
  - batch comparisons
  - fetching stats and prior submissions
  - standalone AI detection

  It also sends selected source choices from the UI to the backend, uses a shared timeout-aware fetch helper, and surfaces clearer request errors.

- `src/components/UploadForm.jsx`
  Entry form for pasting text or uploading files.
  Also lets the user choose which reference sources to use:
  - Wikipedia
  - arXiv
  - IEEE Xplore
  - Stored
  It also captures an optional student name and sends it with checks.
  In the result UI, `Stored` matches are displayed as `Database`.

- `src/components/ScoreSummary.jsx`
  Shows overall plagiarism score, label, confidence, and counts.

- `src/components/AIBadge.jsx`
  Displays the document-level AI-generated content verdict and score breakdown.

- `src/components/SectionHeatmap.jsx`
  Visualizes section-level plagiarism percentages as a chart.
  The numbers are based on backend section scoring, which now uses real heading boundaries when available and weighted plagiarism severity rather than a simple flagged-sentence count.

- `src/components/HighlightedDocument.jsx`
  Shows the whole document inline, with suspicious sentences highlighted inside the running text.
  Clicking a highlighted sentence opens details and the feedback panel.

- `src/components/SentenceList.jsx`
  Card-style sentence-by-sentence analysis view.

- `src/components/SideBySideView.jsx`
  Shows flagged student text next to matched source text with word-level diff highlighting.
  It now renders stored corpus matches as `Database` instead of trying to open a non-browser `kaggle://` link.

- `src/components/FeedbackPanel.jsx`
  Fetches rewrite suggestions for one flagged sentence and supports PDF report download.

- `src/components/SourceFetchStatus.jsx`
  Shows whether each selected source successfully fetched content, returned no results, was skipped, disabled, or failed.
  This prevents source failures from being mistaken for "no plagiarism found."
  For `Stored`, it mainly reflects that the app is searching the local corpus rather than fetching remote content.

- `src/utils/sourceDisplay.js`
  Small frontend helper that decides whether a matched source should be shown as:
  - a clickable external link for web sources
  - a plain `Database` label for local stored corpus records

- `src/components/NetworkGraph.jsx`
  D3-based student similarity graph.
  Displays:
  - pairwise links
  - collaboration rings
  - directed copier/original arrows when timestamps are available

- `public/`
  Static browser assets such as the base HTML file, icons, and manifest.

### `chroma_db/`

Persistent ChromaDB storage used by the corpus search system.

- Contains generated vector data
- Not normally edited by hand

### `venv/`

Python virtual environment.

- Contains installed packages and executables
- Not part of the application source itself

### `.env` and `.env.example`

Environment-variable configuration files.

- `.env`
  Local development configuration. Contains real local values and secrets.

- `.env.example`
  Template file showing which environment variables are expected.
  Safe to share without real secrets.

Typical variables include:

- `MONGODB_URI`
- `CORS_ORIGINS`
- `IEEE_XPLORE_API_KEY`

## Top-Level Files

- `requirements.txt`
  Python dependency list for the backend and ML pipeline.

- `DEPLOYMENT.md`
  Deployment-specific setup instructions.
  Explains which environment variables must be configured locally or on a hosting platform.

- `clean_dataset.py`
  Dataset-cleaning utility for preparing raw student-answer CSV data.

- `test_engine.py`
  CSV seeding script for adding stored reference data into ChromaDB.
  It is mainly used for importing Kaggle or other tabular student-answer datasets so they can be searched later through the `Stored` source option in the UI.
  Those imported references appear to end users as `Database`.

- `text.py`
  Manual script for testing the AI detector with sample human, AI, and mixed texts.

- `debug_ai.py`
  Small debugging script that prints the raw label and confidence returned by the AI model.
  Useful for checking whether the classifier is outputting `Human` or `ChatGPT` and with what score.

## Data Flow

1. A user pastes text or uploads a file in the React frontend.
2. The frontend sends the request to `api/main.py`.
3. The API calls `detector/pipeline.py`.
4. The pipeline extracts text, builds or queries the corpus, embeds sentences, and runs the 3-layer plagiarism detector.
5. The pipeline fetches selected sources, records per-source fetch status, and computes section-level plagiarism scores.
   If `Stored` is selected, it reuses existing locally saved corpus entries instead of fetching from the web.
6. The pipeline also runs document-level AI-generated text detection.
7. The API stores submission results in MongoDB and returns structured JSON.
8. The frontend renders score summary, source-fetch status, highlighted text, sentence cards, side-by-side comparisons, AI badge, section heatmap, and network views.
9. Web sources keep clickable URLs, while local stored matches are shown as `Database`.

## Reference Source Behavior

- `Wikipedia`, `arXiv`, and `IEEE Xplore`
  These are external sources. The backend may fetch new corpus material from them during a run, and matched results usually include clickable URLs.

- `Stored`
  This is local corpus data already saved in ChromaDB, including imports from `test_engine.py`.
  It does not depend on a public website at match time.
  In the UI, it is shown as `Database` rather than a raw internal identifier.

## Important Files

- `api/main.py`
  This is the main backend entrypoint and the best file to read first if someone wants to understand how the system is exposed externally.
  It defines request models, API routes, response shaping, source validation, MongoDB access helpers, and report download endpoints.
  It now also returns `source_name` with each sentence result so the frontend can distinguish real web references from local `Database` references.
  It stores optional student names with submissions for both text and file checks.
  If the frontend is missing data or a route behaves unexpectedly, this file is one of the first places to inspect.

- `detector/pipeline.py`
  This is the main orchestration layer for a single plagiarism check.
  It connects extraction, sentence filtering, source-specific corpus fetching, embeddings, plagiarism scoring, aggregation, source-fetch diagnostics, and AI-detection into one flow.
  It also decides when a source is fetched from the web versus when the run should only search already stored local corpus data.
  If the final document result looks wrong, this file is the best place to trace how the result was assembled.

- `detector/detector.py`
  This file contains the core plagiarism decision logic.
  It defines how exact matches, semantic similarity, and paraphrase cases are scored and labeled.
  It also computes section-level plagiarism scores.
  If thresholds, confidence levels, plagiarism labels, or section scoring need to change, this is the key file.

- `detector/ai_detector.py`
  This is the document-level AI-generated text detector.
  It combines a classifier model, heuristic phrase scoring, statistical writing-pattern signals, and an extra structure/style signal.
  If AI results are too weak, too aggressive, or biased toward `HUMAN`, this is the main file to tune.

- `detector/corpus.py`
  This file controls how the reference corpus is built and queried.
  It fetches source material from Wikipedia, arXiv, and IEEE Xplore, stores vectorized sentences in ChromaDB, and returns candidate matches for comparison.
  It also handles stored/local corpus records, enforces source filtering during retrieval, and normalizes stored-source labels to `Database`.
  If matched sources look irrelevant, a selected source is being ignored, a stored reference is being labeled incorrectly, or IEEE fetch is failing, this file matters.

- `detector/extractor.py`
  This file reads uploaded PDF, DOCX, and TXT files and converts them into clean text plus sentence lists.
  If uploads fail, text extraction is noisy, or sentence splitting breaks, this is the right place to inspect.

- `detector/embedder.py`
  This file loads the sentence-transformer model and turns sentences into embeddings.
  If semantic matching is slow, memory-heavy, or low quality, changes often start here.

- `detector/feedback.py`
  This file generates student-facing rewrite suggestions for flagged text.
  If the feedback sounds repetitive, weak, or too generic, this file controls that behavior.

- `detector/report_generator.py`
  This file creates the downloadable PDF report.
  If the report format, included sections, wording, or layout needs to change, this is the file to edit.

- `frontend/src/App.jsx`
  This is the main frontend composition file.
  It wires together the upload form, score summary, AI badge, highlighted document view, sentence-card view, side-by-side view, stats tab, and network graph tab.
  It also owns global theme injection and the lightweight stats-fetch lifecycle.
  If something is not appearing in the UI, this is usually the first frontend file to check.

- `frontend/src/api.js`
  This file is the frontend-to-backend bridge.
  It wraps calls to the FastAPI endpoints, shapes the request payloads the UI sends, and applies timeout/error handling to network requests.
  If the UI is hitting the wrong route or missing request fields, this file is usually involved.

- `frontend/src/components/UploadForm.jsx`
  This file controls the user’s source selection and sends those choices into the plagiarism-check workflow.
  It now includes the `Stored` option for local database-backed corpus entries.
  If the chosen source set is wrong or missing, this is one of the first frontend files to inspect.

- `frontend/src/components/HighlightedDocument.jsx`
  This is one of the most important result-rendering files.
  It shows the full document inline with suspicious sentences highlighted inside the running text, opens the feedback panel for selected passages, and displays either external source links or a `Database` label for stored corpus matches.

- `frontend/src/components/SentenceList.jsx`
  This is the alternative card-based sentence analysis view.
  It is especially useful for debugging sentence-level output because each sentence is rendered as its own record with label, explanation, and resolved source display.

- `frontend/src/components/FeedbackPanel.jsx`
  This file handles rewrite suggestions and PDF report download from the UI.
  If suggestion loading or report download is failing, this is an important frontend file to inspect.

- `frontend/src/components/SourceFetchStatus.jsx`
  This file makes source-fetch problems visible to the user.
  If a selected source is failing silently, getting disabled, or needs better diagnostics in the UI, this is the file to inspect.

- `frontend/src/utils/sourceDisplay.js`
  This helper decides how matched-source information should appear in the UI.
  It keeps Wikipedia/arXiv/IEEE sources clickable and forces local stored references to appear simply as `Database`.

- `frontend/src/components/NetworkGraph.jsx`
  This file powers the batch-analysis visualization.
  It renders student-to-student links, clusters, and directional copier/original arrows using D3.
  If batch results are hard to understand visually, this is where the visual logic lives.

- `text.py`
  This is a quick manual AI-detector test script.
  It is useful when debugging AI detection without running the full application.

- `debug_ai.py`
  This is a lower-level AI debugging script that prints the raw model label and confidence.
  It is useful for checking whether a problem comes from the model output itself or from the app’s post-processing logic.

## Notes For New Developers

- `venv/`, `frontend/node_modules/`, and `chroma_db/` are environment or runtime directories and should usually not be edited directly.
- The project uses both ChromaDB and MongoDB:
  - ChromaDB stores the reference corpus vectors
  - MongoDB stores submissions, cached embeddings, and pair results
- Source selection now affects both:
  - what gets fetched into the corpus for that run
  - what existing corpus records are allowed to match
- Stored datasets imported through `test_engine.py` are searched from the existing Chroma corpus and shown in the UI as `Database`.
- The frontend API layer now applies request timeouts, so slow or blocked backend endpoints show clearer UI errors instead of generic browser failures.
- IEEE Xplore support depends on:
  - a valid `IEEE_XPLORE_API_KEY`
  - backend network access to the IEEE API
- If IEEE returns `Developer Inactive`, the backend disables IEEE fetches for the rest of that process to avoid repeated failing calls.
- The frontend currently has multiple result views, so if UI output changes, `App.jsx` and the components it switches between are the first places to inspect.
- The section heatmap is now more reliable than before because section assignment uses detected headings when available, not only sentence keyword matching.
- `text.py` and `debug_ai.py` are useful for sanity-checking AI-detection behavior without running the full app.
