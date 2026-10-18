/**
 * The backend, reimplemented in the browser.
 *
 * Mirrors the shapes in services/api.ts so components do not know which one they
 * are talking to. Documents are parsed, extracted, and stored in this tab —
 * nothing is uploaded.
 */

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import type {
  AppSettings, DocumentDetail, DocumentListResponse, DocumentStatus, DocumentSummary,
  DocumentType, DocumentUpdate, DuplicateInfo, ImportResponse, SearchFilters, Stats, Tag,
} from '../types';
import { extractFields, type Extraction } from './extract';
import { DOCS, FILES, TAGS, getAll, get, put, remove, sha256, storageUsage } from './store';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_SIZE = 50 * 1024 * 1024;
const ACCEPTED = /\.(pdf|jpe?g|png|tiff?|webp|bmp)$/i;

interface StoredDoc extends DocumentDetail {
  file_hash: string;
  raw_text: string;
}

const now = () => new Date().toISOString();
const num = (f: { value: string | null }) => (f.value === null ? null : Number(f.value));

/** Read a PDF's text layer. Images need OCR, which this build does not ship. */
async function readText(file: File): Promise<string> {
  if (!/\.pdf$/i.test(file.name)) return '';
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    let line = '';
    let lastY: number | null = null;
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = item.transform[5] as number;
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        pages.push(line.trim());
        line = '';
      }
      line += item.str;
      lastY = y;
    }
    pages.push(line.trim());
  }
  await task.destroy();
  return pages.filter(Boolean).join('\n');
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

export async function fileUrl(id: string): Promise<string> {
  const cached = objectUrls.get(id);
  if (cached) return cached;
  const file = await get<File>(FILES, id);
  if (!file) return '';
  const url = URL.createObjectURL(file);
  objectUrls.set(id, url);
  return url;
}

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

export async function getSettings(): Promise<AppSettings> {
  const { files, bytes } = await storageUsage();
  return {
    app: { name: 'Kiroku', version: '1.0.0' },
    storage: { total_files: files, total_bytes: bytes },
    // OCR needs a WASM engine this build does not ship; PDFs read their text layer.
    capabilities: { pdfplumber: true, tesseract_ocr: false, pdf_preview: false },
  };
}
