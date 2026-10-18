# Kiroku

Kiroku (記録, "records") turns a folder of invoices, receipts, and bills into a
searchable, exportable set of financial records. It reads the vendor, dates, amounts,
and tax off each document, flags anything it is unsure about for you to check, and
exports a CSV your accountant can use.

Everything runs on your own machine against a local SQLite database.

![MIT licence](https://img.shields.io/badge/licence-MIT-blue)

## Features

- Drag-and-drop import of PDFs, JPEG, PNG, TIFF, WEBP, and BMP, up to 50 MB each
- Reads the PDF text layer directly, falling back to OCR for scans and photos
- Extracts vendor, document number, issue and due dates, currency, subtotal, tax,
  total, and payment terms, each with a confidence score
- Duplicate detection: exact matches by file hash, probable matches by vendor,
  amount, and date
- A review queue holding anything extracted below the confidence threshold, so nothing
  reaches an export without a human looking at it; the document view warns separately
  when subtotal and tax do not add up to the total
- User-defined categories and full-text search across vendors, numbers, and notes
- CSV export, filterable by date range, type, and confirmed status

Kiroku never invents a value it could not read — missing fields stay empty.

## Requirements

- Python 3.11+
- Node 18+
- Tesseract, for scanned documents and photos
  (`brew install tesseract`, `apt install tesseract-ocr`)
- Poppler, for PDF page previews (`brew install poppler`, `apt install poppler-utils`)

## Setup

```bash
python3 -m venv venv && source venv/bin/activate
pip install -r backend/requirements.txt

cd frontend && npm install && npm run build && cd ..

python run.py
```

Then open http://127.0.0.1:8000. That address serves the landing page; "Open Kiroku"
takes you into the app at `/documents`.

For frontend development, run `npm run dev` in `frontend/` and use the Vite server on
port 5173; it proxies the API to the backend.

### Optional classifier

`pip install -r backend/requirements-ml.txt` adds a zero-shot model that improves
document-type classification. It downloads roughly 250 MB of weights from the Hugging
Face Hub the first time it runs, then works offline.

The model loads in the background and is never waited on, so importing a document is
not held up by a slow or unreachable Hub — documents imported before it is ready are
classified by keyword instead. Without the extra install, Kiroku always classifies by
keyword and makes no network requests at all. `KIROKU_DISABLE_ML=1` turns it off
without uninstalling.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `KIROKU_DATA_DIR` | `./data` | Where documents, previews, and the database live |
| `KIROKU_DISABLE_ML` | unset | Set to `1` to skip the classifier model |

## Your data

Documents and records stay in `KIROKU_DATA_DIR` as ordinary files — a SQLite database
and the original uploads. Nothing is encrypted at rest, so enable full-disk encryption
if the machine is shared. Back up by copying that directory. See
[docs/SECURITY.md](docs/SECURITY.md) for the threat model and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it fits together.

## Landing page

`docs/index.html` is a single self-contained landing page, served two ways:

- **Locally** at `http://127.0.0.1:8000/`, with its main button pointing into the app.
- **Publicly** via GitHub Pages — set Pages to deploy from the `main` branch `/docs`
  folder, and replace the `YOUR-ORG` placeholders in that file with the repository URL.
  Off localhost the same button becomes "Get started" and links to the install steps.

The Vite dev server (`npm run dev`, port 5173) serves the app at `/` instead, so
development goes straight to the UI.

## Licence

MIT. See [LICENSE](LICENSE).
