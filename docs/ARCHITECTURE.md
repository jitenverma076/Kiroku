# Architecture

Kiroku has two interchangeable engines behind one UI. By default the browser does the
work; a Python backend can do it instead for people who want records in files on disk.

## The seam

`frontend/src/services/api.ts` is the only module any component imports for data. It
dispatches on one build-time value:

```
VITE_API_BASE unset  ->  services/local.ts   (IndexedDB, in the tab)
VITE_API_BASE set    ->  fetch(`${VITE_API_BASE}/...`)  (FastAPI backend)
```

Components never know which is live, so neither engine can drift into the UI layer.

## Browser engine (default)

- **`services/extract.ts`** — labelled-regex field extraction and keyword
  classification, with a confidence score per field.
- **`services/store.ts`** — IndexedDB (`documents`, `files`, `previews`, `tags`) and
  SHA-256 via Web Crypto.
- **`services/local.ts`** — the pipeline: read text, extract, detect duplicates,
  render a thumbnail, store. Also CSV export and JSON backup/restore.
- **`pdf.js`** reads PDF text layers and rasterises page 1 for thumbnails. It is
  ~480 kB, so it is a lazy chunk fetched on first import, not on page load.
- **`tesseract.js`** handles scans and photos, and PDFs with no text layer. Its WASM
  and language data download on first use.

## Backend engine (optional)

FastAPI, SQLAlchemy over SQLite (WAL), pdfplumber for PDF text, Tesseract for OCR,
pdf2image/poppler for previews.

```
backend/src/
  main.py               app, CORS, routers, static serving, SPA fallback
  commands/             route handlers
  services/             import pipeline, CSV export, document CRUD
  ai/                   classification and field extraction
  document_processing/  PDF text layer and OCR
  domain/               Pydantic models
  storage/              SQLAlchemy models, file store
```

It also serves the landing page at `/` and the built SPA for app routes, so a
self-hosted install is a single origin.

## Import pipeline

Identical in both engines:

1. Reject unsupported types and anything over 50 MB.
2. Hash the file; an identical hash is an exact duplicate.
3. Read the text layer, falling back to OCR.
4. Classify, then extract fields with confidence scores.
5. Flag as `review_needed` when the total is missing, when subtotal + tax does not
   reconcile with the total, or when overall confidence is below 0.6.
6. Compare vendor + amount + date (±7 days) against existing records for a probable
   duplicate.

## Duplicated extraction rules

`extract.ts` and `ai/extractor.py` implement the same rules in two languages, because
either engine may run them. Both carry self-checks over identical cases
(`npm run check`, `python -m ai.extractor`). Nothing enforces agreement automatically
— if the browser engine ever gains everything the backend does, delete one.

## Network behaviour

The browser engine makes no requests with your documents in them. It fetches static
assets, and on first use downloads the OCR WASM and language data.

The backend's optional classifier (`requirements-ml.txt`) downloads model weights from
the Hugging Face Hub. That load runs on a background thread and is never awaited, so
an unreachable Hub costs nothing on the import path — classification falls back to
keywords. Install only `requirements.txt`, or set `KIROKU_DISABLE_ML=1`, to stay offline.
