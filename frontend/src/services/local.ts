/**
 * The backend, reimplemented in the browser.
 *
 * Mirrors the shapes in services/api.ts so components do not know which one they
 * are talking to. Documents are parsed, extracted, and stored in this tab —
 * nothing is uploaded.
 */

import type {
  AppSettings, DocumentDetail, DocumentListResponse, DocumentStatus, DocumentSummary,
  DocumentType, DocumentUpdate, DuplicateInfo, ImportResponse, SearchFilters, Stats, Tag,
} from '../types';
import { extractFields, type Extraction } from './extract';
import { DOCS, FILES, PREVIEWS, TAGS, getAll, get, put, remove, sha256, storageUsage } from './store';

/** pdf.js is ~500 kB, so it is fetched on first import rather than on page load. */
async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

const isPdf = (file: File) => /\.pdf$/i.test(file.name);

const MAX_SIZE = 50 * 1024 * 1024;
const ACCEPTED = /\.(pdf|jpe?g|png|tiff?|webp|bmp)$/i;

interface StoredDoc extends DocumentDetail {
  file_hash: string;
  raw_text: string;
}

const now = () => new Date().toISOString();
const num = (f: { value: string | null }) => (f.value === null ? null : Number(f.value));

/** Text from a PDF's own text layer, or OCR for scans and photos. */
async function readText(file: File): Promise<string> {
  if (!isPdf(file)) return ocr(file);

  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const doc = await task.promise;
  const lines: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    let line = '';
    let lastY: number | null = null;
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = item.transform[5] as number;
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        lines.push(line.trim());
        line = '';
      }
      line += item.str;
      lastY = y;
    }
    lines.push(line.trim());
  }
  await task.destroy();

  const text = lines.filter(Boolean).join('\n');
  // A PDF of a scan has no text layer; fall through to OCR.
  return text.trim().length >= 20 ? text : await ocrPdfFirstPage(file);
}

/** Recognise text in an image. The worker and language data download on first use. */
async function ocr(source: Blob): Promise<string> {
  try {
    const { recognize } = await import('tesseract.js');
    const { data } = await recognize(source, 'eng');
    return data.text ?? '';
  } catch (e) {
    console.warn('OCR unavailable, import the document and fill fields in by hand', e);
    return '';
  }
}

async function ocrPdfFirstPage(file: File): Promise<string> {
  const blob = await renderFirstPage(file, 2);
  return blob ? ocr(blob) : '';
}

/** Rasterise page 1, used for both the card thumbnail and OCR of scanned PDFs. */
async function renderFirstPage(file: File, scale = 1): Promise<Blob | null> {
  if (!isPdf(file)) return file;
  try {
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) return null;
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    await task.destroy();
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  } catch (e) {
    console.warn('Preview could not be rendered', e);
    return null;
  }
}

function toSummary(d: StoredDoc): DocumentSummary {
  const { ...rest } = d;
  return rest;
}

function buildDoc(
  id: string, file: File, hash: string, text: string, ex: Extraction,
  previous?: StoredDoc,
): StoredDoc {
  const tags = previous?.tags ?? [];
  const edited = new Set((previous?.fields ?? []).filter(f => f.user_edited).map(f => f.field_name));
  const keep = <T>(name: string, fresh: T, old: T): T => (edited.has(name) ? old : fresh);

  const fields = (
    [
      ['vendor', ex.vendor], ['doc_number', ex.docNumber], ['issue_date', ex.issueDate],
      ['due_date', ex.dueDate], ['currency', ex.currency], ['subtotal', ex.subtotal],
      ['tax_amount', ex.taxAmount], ['total_amount', ex.totalAmount],
      ['payment_terms', ex.paymentTerms],
    ] as const
  ).map(([name, f]) => ({
    id: `${id}-${name}`,
    field_name: name,
    value: f.value,
    confidence: f.confidence,
    user_edited: edited.has(name),
  }));

  return {
    id,
    filename: file.name,
    status: (ex.needsReview ? 'review_needed' : 'confirmed') as DocumentStatus,
    doc_type: ex.docType as DocumentType,
    vendor: keep('vendor', ex.vendor.value, previous?.vendor ?? null),
    doc_number: keep('doc_number', ex.docNumber.value, previous?.doc_number ?? null),
    issue_date: keep('issue_date', ex.issueDate.value, previous?.issue_date ?? null),
    due_date: keep('due_date', ex.dueDate.value, previous?.due_date ?? null),
    currency: keep('currency', ex.currency.value, previous?.currency ?? null),
    subtotal: keep('subtotal', num(ex.subtotal), previous?.subtotal ?? null),
    tax_amount: keep('tax_amount', num(ex.taxAmount), previous?.tax_amount ?? null),
    total_amount: keep('total_amount', num(ex.totalAmount), previous?.total_amount ?? null),
    payment_terms: keep('payment_terms', ex.paymentTerms.value, previous?.payment_terms ?? null),
    notes: previous?.notes ?? null,
    confidence: ex.overallConfidence,
    user_confirmed: previous?.user_confirmed ?? false,
    imported_at: previous?.imported_at ?? now(),
    updated_at: now(),
    preview_path: null,
    tags,
    error_message: null,
    file_size: file.size,
    mime_type: file.type || 'application/octet-stream',
    file_hash: hash,
    fields,
    raw_text: text.slice(0, 50000),
  };
}

export async function uploadDocument(file: File): Promise<ImportResponse> {
  if (!ACCEPTED.test(file.name)) {
    return {
      filename: file.name, accepted: false,
      error: `Unsupported file type. Accepted: PDF, JPEG, PNG, TIFF, WEBP, BMP`,
    };
  }
  if (file.size > MAX_SIZE) {
    return { filename: file.name, accepted: false, error: 'File too large. Maximum size is 50 MB.' };
  }

  const hash = await sha256(file);
  const docs = await getAll<StoredDoc>(DOCS);

  const exact = docs.find(d => d.file_hash === hash);
  if (exact) {
    const duplicate: DuplicateInfo = {
      type: 'exact',
      existing_document_id: exact.id,
      existing_filename: exact.filename,
      reason: `Identical file already imported as '${exact.filename}'`,
    };
    return { filename: file.name, accepted: false, duplicate };
  }

  const id = crypto.randomUUID();
  const text = await readText(file);
  const doc = buildDoc(id, file, hash, text, extractFields(text));

  // Same vendor, same total, within a week — probably the same bill twice.
  const probable = docs.find(
    d =>
      d.vendor && d.vendor === doc.vendor &&
      d.total_amount !== null && d.total_amount === doc.total_amount &&
      d.issue_date && doc.issue_date &&
      Math.abs(Date.parse(d.issue_date) - Date.parse(doc.issue_date)) <= 7 * 864e5,
  );

  await put(FILES, file, id);
  const preview = await renderFirstPage(file);
  if (preview) {
    await put(PREVIEWS, preview, id);
    doc.preview_path = id;
  }
  await put(DOCS, doc);

  return {
    document_id: id,
    filename: file.name,
    accepted: true,
    duplicate: probable
      ? {
          type: 'probable',
          existing_document_id: probable.id,
          existing_filename: probable.filename,
          reason: `Same vendor and amount as '${probable.filename}'`,
        }
      : undefined,
  };
}

export async function reprocessDocument(id: string): Promise<void> {
  const previous = await get<StoredDoc>(DOCS, id);
  const file = await get<File>(FILES, id);
  if (!previous || !file) throw new Error('Document not found');
  const text = await readText(file);
  await put(DOCS, buildDoc(id, file, previous.file_hash, text, extractFields(text), previous));
}

const matches = (d: StoredDoc, f: SearchFilters): boolean => {
  const q = f.query?.toLowerCase();
  if (q && ![d.vendor, d.doc_number, d.notes].some(v => v?.toLowerCase().includes(q))) return false;
  if (f.doc_type && d.doc_type !== f.doc_type) return false;
  if (f.status && d.status !== f.status) return false;
  if (f.date_from && (!d.issue_date || d.issue_date < f.date_from)) return false;
  if (f.date_to && (!d.issue_date || d.issue_date > f.date_to)) return false;
  if (f.currency && d.currency !== f.currency) return false;
  if (f.amount_min != null && (d.total_amount ?? -Infinity) < f.amount_min) return false;
  if (f.amount_max != null && (d.total_amount ?? Infinity) > f.amount_max) return false;
  return true;
};

export async function listDocuments(filters: SearchFilters = {}): Promise<DocumentListResponse> {
  const all = (await getAll<StoredDoc>(DOCS)).filter(d => matches(d, filters));

  const key = filters.sort_by ?? 'imported_at';
  const dir = filters.sort_dir === 'asc' ? 1 : -1;
  all.sort((a, b) => {
    const x = (a as unknown as Record<string, unknown>)[key];
    const y = (b as unknown as Record<string, unknown>)[key];
    if (x == null) return 1;
    if (y == null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });

  const page = filters.page ?? 1;
  const size = filters.page_size ?? 20;
  return {
    documents: all.slice((page - 1) * size, page * size).map(toSummary),
    total: all.length,
    page,
    page_size: size,
    total_pages: Math.max(1, Math.ceil(all.length / size)),
  };
}

export async function getDocument(id: string): Promise<DocumentDetail> {
  const doc = await get<StoredDoc>(DOCS, id);
  if (!doc) throw new Error('Document not found');
  return doc;
}

export async function updateDocument(id: string, update: DocumentUpdate): Promise<DocumentDetail> {
  const doc = await get<StoredDoc>(DOCS, id);
  if (!doc) throw new Error('Document not found');

  const next: StoredDoc = { ...doc, ...update, updated_at: now() };
  if (update.user_confirmed && doc.status === 'review_needed') next.status = 'confirmed';
  // A field the user typed must survive re-extraction.
  next.fields = doc.fields.map(f =>
    f.field_name in update
      ? { ...f, value: String((update as Record<string, unknown>)[f.field_name] ?? ''), user_edited: true }
      : f,
  );
  await put(DOCS, next);
  return next;
}

export async function deleteDocument(id: string): Promise<void> {
  await remove(DOCS, id);
  await remove(FILES, id);
  await remove(PREVIEWS, id);
}

export async function getReviewQueue(): Promise<DocumentSummary[]> {
  const all = await getAll<StoredDoc>(DOCS);
  return all.filter(d => d.status === 'review_needed' && !d.user_confirmed).map(toSummary);
}

export async function getStats(): Promise<Stats> {
  const all = await getAll<StoredDoc>(DOCS);
  const by_status: Record<string, number> = {
    pending: 0, processing: 0, review_needed: 0, confirmed: 0, error: 0,
  };
  for (const d of all) by_status[d.status] = (by_status[d.status] ?? 0) + 1;
  return {
    total_documents: all.length,
    by_status,
    total_value: Number(all.reduce((s, d) => s + (d.total_amount ?? 0), 0).toFixed(2)),
  };
}

// ponytail: object URLs are cached for the tab's lifetime rather than revoked per
// view — a handful of small blobs. Revoke on navigation if memory ever matters.
const objectUrls = new Map<string, string>();

async function blobUrl(store: string, id: string): Promise<string> {
  const key = `${store}:${id}`;
  const cached = objectUrls.get(key);
  if (cached) return cached;
  const blob = await get<Blob>(store, id);
  if (!blob) return '';
  const url = URL.createObjectURL(blob);
  objectUrls.set(key, url);
  return url;
}

export const fileUrl = (id: string) => blobUrl(FILES, id);
export const previewUrl = (id: string) => blobUrl(PREVIEWS, id);

const CSV_COLUMNS = [
  'id', 'type', 'vendor', 'doc_number', 'issue_date', 'due_date', 'currency',
  'subtotal', 'tax_amount', 'total', 'status', 'tags', 'imported_at',
];

const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const money = (v: number | null) => (v === null ? '' : v.toFixed(2));

export async function exportCsv(ids?: string[]): Promise<Blob> {
  const all = (await getAll<StoredDoc>(DOCS))
    .filter(d => !ids || ids.includes(d.id))
    .sort((a, b) => (a.imported_at < b.imported_at ? 1 : -1));

  const rows = all.map(d =>
    [
      d.id, d.doc_type ?? '', d.vendor ?? '', d.doc_number ?? '', d.issue_date ?? '',
      d.due_date ?? '', d.currency ?? '', money(d.subtotal), money(d.tax_amount),
      money(d.total_amount), d.status, d.tags.map(t => t.name).sort().join('|'), d.imported_at,
    ].map(cell).join(','),
  );

  // BOM keeps Excel happy with UTF-8.
  return new Blob(['﻿' + [CSV_COLUMNS.map(cell).join(','), ...rows].join('\r\n') + '\r\n'], {
    type: 'text/csv;charset=utf-8',
  });
}

export async function listTags(): Promise<Tag[]> {
  const [tags, docs] = await Promise.all([getAll<Tag>(TAGS), getAll<StoredDoc>(DOCS)]);
  return tags
    .map(t => ({ ...t, document_count: docs.filter(d => d.tags.some(x => x.id === t.id)).length }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createTag(name: string): Promise<Tag> {
  const existing = (await getAll<Tag>(TAGS)).find(t => t.name.toLowerCase() === name.toLowerCase());
  if (existing) throw new Error(`Category "${name}" already exists`);
  const tag: Tag = { id: crypto.randomUUID(), name };
  await put(TAGS, tag);
  return tag;
}

export async function deleteTag(tagId: string): Promise<void> {
  await remove(TAGS, tagId);
  for (const d of await getAll<StoredDoc>(DOCS)) {
    if (d.tags.some(t => t.id === tagId)) {
      await put(DOCS, { ...d, tags: d.tags.filter(t => t.id !== tagId) });
    }
  }
}

export async function addTagToDocument(documentId: string, tagName: string): Promise<void> {
  const doc = await get<StoredDoc>(DOCS, documentId);
  if (!doc) throw new Error('Document not found');
  const tags = await getAll<Tag>(TAGS);
  const tag = tags.find(t => t.name.toLowerCase() === tagName.toLowerCase())
    ?? { id: crypto.randomUUID(), name: tagName };
  if (!tags.some(t => t.id === tag.id)) await put(TAGS, tag);
  if (!doc.tags.some(t => t.id === tag.id)) await put(DOCS, { ...doc, tags: [...doc.tags, tag] });
}

export async function removeTagFromDocument(documentId: string, tagId: string): Promise<void> {
  const doc = await get<StoredDoc>(DOCS, documentId);
  if (!doc) return;
  await put(DOCS, { ...doc, tags: doc.tags.filter(t => t.id !== tagId) });
}

const toBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * Everything needed to restore this library, as one JSON file.
 *
 * Browser storage is erased by "clear site data", so a backup is the durability
 * story for records that have to survive a few tax years.
 *
 * ponytail: originals are inlined as base64, which holds the whole library in
 * memory while writing. Stream to a zip if libraries get large.
 */
export async function exportBackup(): Promise<Blob> {
  const docs = await getAll<StoredDoc>(DOCS);
  const files: Record<string, string> = {};
  for (const d of docs) {
    const file = await get<File>(FILES, d.id);
    if (file) files[d.id] = await toBase64(file);
  }
  const backup = {
    kiroku_backup: 1,
    exported_at: now(),
    documents: docs,
    tags: await getAll<Tag>(TAGS),
    files,
  };
  return new Blob([JSON.stringify(backup)], { type: 'application/json' });
}

/** Restore a backup, skipping documents already present. Returns how many were added. */
export async function importBackup(file: File): Promise<number> {
  const data = JSON.parse(await file.text());
  if (data?.kiroku_backup !== 1) throw new Error('Not a Kiroku backup file');

  const existing = new Set((await getAll<StoredDoc>(DOCS)).map(d => d.id));
  for (const tag of (data.tags ?? []) as Tag[]) await put(TAGS, tag);

  let added = 0;
  for (const doc of (data.documents ?? []) as StoredDoc[]) {
    if (existing.has(doc.id)) continue;
    const b64 = (data.files ?? {})[doc.id];
    if (b64) {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const restored = new File([bytes], doc.filename, { type: doc.mime_type });
      await put(FILES, restored, doc.id);
      const preview = await renderFirstPage(restored);
      if (preview) await put(PREVIEWS, preview, doc.id);
    }
    await put(DOCS, doc);
    added += 1;
  }
  return added;
}

export async function getSettings(): Promise<AppSettings> {
  const { files, bytes } = await storageUsage();
  return {
    app: { name: 'Kiroku', version: '1.0.0' },
    storage: { total_files: files, total_bytes: bytes },
    capabilities: { pdfplumber: true, tesseract_ocr: true, pdf_preview: true },
  };
}
