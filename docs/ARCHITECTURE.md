# Architecture

## Stack

- **Backend** — Python 3.11+, FastAPI, SQLAlchemy over SQLite (WAL mode)
- **Frontend** — React 18, TypeScript, Vite; a single-page app served by the backend in production
- **Text extraction** — pdfplumber for PDF text layers, Tesseract (via pytesseract) for scans and photos
- **Previews** — pdf2image + poppler
- **Field extraction** — labelled-regex parsing with per-field confidence scores
- **Classification** — keyword and structure matching, optionally supplemented by a local zero-shot model

Frontend and backend talk over REST on localhost.

## Layout

```
backend/src/
  main.py               FastAPI app, CORS, routers, SPA fallback
  commands/             Route handlers
  services/             Orchestration: import pipeline, CSV export, document CRUD
  ai/                   Classification and field extraction
  document_processing/  PDF text layer and OCR
  domain/               Pydantic models and enums
  storage/              SQLAlchemy models, file store

frontend/src/
  app/App.tsx           Shell, routing, navigation
  features/             One directory per screen
  services/api.ts       Typed API client
  components/ui/        Shared components
  styles/global.css     Design tokens and component styles
```

## Import pipeline

1. Upload is written to managed storage under `data/documents/{id}/`.
2. SHA-256 of the file is compared against existing records (exact duplicate), then
   vendor + amount + date within ±7 days (probable duplicate).
3. Text is read from the PDF text layer, falling back to OCR.
4. The document is classified, then fields are extracted with confidence scores.
5. Anything low-confidence, or whose subtotal + tax does not match the total, is
   marked `review_needed` rather than confirmed.

## Database

- `documents` — file metadata, extracted fields, status, confidence, timestamps
- `document_fields` — per-field value, confidence, and whether a user edited it
- `tags` / `document_tags` — user-defined categories, many-to-many

Status moves `pending → processing → review_needed → confirmed`, or `→ error`.

User edits set `user_edited`, and re-extraction will not overwrite those fields.

## Network behaviour

Document processing makes no network requests. The one exception is the optional
classifier from `requirements-ml.txt`: Transformers contacts the Hugging Face Hub to
fetch and revalidate model weights.

That load runs on a background thread and is never awaited, so an unreachable Hub costs
nothing on the import path — `classify()` returns `None` until the model is ready and
callers fall back to keyword matching. Install only `requirements.txt`, or set
`KIROKU_DISABLE_ML=1`, to keep the process fully offline.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `KIROKU_DATA_DIR` | `./data` | Where documents, previews, and the database live |
| `KIROKU_DISABLE_ML` | unset | Set to `1` to skip the classifier model entirely |
| `HF_CLASSIFIER_MODEL` | `typeform/distilbert-base-uncased-mnli` | Classifier to load |
