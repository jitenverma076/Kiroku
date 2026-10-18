/**
 * Kiroku API Client
 *
 * Typed fetch wrappers for all backend API endpoints.
 * All requests go to localhost — no external network calls.
 */

import type {
  AppSettings, DocumentDetail, DocumentListResponse, DocumentSummary,
  DocumentUpdate, ImportResponse, SearchFilters, Stats, Tag,
} from '../types';

import * as local from './local';

// Kiroku runs entirely in the browser by default: documents are parsed, extracted,
// and stored in this tab, and nothing is uploaded. Set VITE_API_BASE at build time
// to talk to a self-hosted backend instead.
const API_BASE = import.meta.env.VITE_API_BASE ?? '';
const LOCAL = API_BASE === '';

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      message = body.detail || body.message || message;
    } catch {
      // Use default message
    }
    throw new ApiError(message, response.status);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json() as Promise<T>;
  }
  return response as unknown as T;
}

// ── Documents ─────────────────────────────────────────────────────────────────

export async function listDocuments(filters: SearchFilters = {}): Promise<DocumentListResponse> {
  if (LOCAL) return local.listDocuments(filters);
  const params = new URLSearchParams();
  if (filters.query) params.set('query', filters.query);
  if (filters.doc_type) params.set('doc_type', filters.doc_type);
  if (filters.status) params.set('status', filters.status);
  if (filters.date_from) params.set('date_from', filters.date_from);
  if (filters.date_to) params.set('date_to', filters.date_to);
  if (filters.amount_min != null) params.set('amount_min', String(filters.amount_min));
  if (filters.amount_max != null) params.set('amount_max', String(filters.amount_max));
  if (filters.currency) params.set('currency', filters.currency);
  if (filters.sort_by) params.set('sort_by', filters.sort_by);
  if (filters.sort_dir) params.set('sort_dir', filters.sort_dir);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.page_size) params.set('page_size', String(filters.page_size));

  const qs = params.toString();
  return request<DocumentListResponse>(`/documents${qs ? `?${qs}` : ''}`);
}

export async function getDocument(id: string): Promise<DocumentDetail> {
  if (LOCAL) return local.getDocument(id);
  return request<DocumentDetail>(`/documents/${id}`);
}

export async function updateDocument(id: string, update: DocumentUpdate): Promise<DocumentDetail> {
  if (LOCAL) return local.updateDocument(id, update);
  return request<DocumentDetail>(`/documents/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(update),
  });
}

export async function deleteDocument(id: string): Promise<void> {
  if (LOCAL) return local.deleteDocument(id);
  await request(`/documents/${id}`, { method: 'DELETE' });
}

export async function bulkDeleteDocuments(ids: string[]): Promise<void> {
  await request('/documents', {
    method: 'DELETE',
    body: JSON.stringify(ids),
  });
}

export async function getReviewQueue(): Promise<DocumentSummary[]> {
  if (LOCAL) return local.getReviewQueue();
  return request<DocumentSummary[]>('/documents/review-queue');
}

export async function getStats(): Promise<Stats> {
  if (LOCAL) return local.getStats();
  return request<Stats>('/documents/stats');
}

// ── Processing ────────────────────────────────────────────────────────────────

export async function uploadDocument(
  file: File,
  skipDuplicateCheck = false,
): Promise<ImportResponse> {
  if (LOCAL) return local.uploadDocument(file);

  const formData = new FormData();
  formData.append('file', file);
  formData.append('skip_duplicate_check', String(skipDuplicateCheck));

  const response = await fetch(`${API_BASE}/processing/upload`, {
    method: 'POST',
    body: formData,
    // Don't set Content-Type — browser sets it with boundary
  });

  if (!response.ok) {
    let message = `Upload failed: HTTP ${response.status}`;
    try {
      const body = await response.json();
      message = body.detail || message;
    } catch {
      // Use default
    }
    throw new ApiError(message, response.status);
  }

  return response.json() as Promise<ImportResponse>;
}

export async function reprocessDocument(id: string): Promise<void> {
  if (LOCAL) return local.reprocessDocument(id);
  await request(`/processing/${id}/reprocess`, { method: 'POST' });
}

export function getPreviewUrl(documentId: string): string {
  return LOCAL ? '' : `${API_BASE}/processing/preview/${documentId}`;
}

/** Resolves to a blob URL in browser mode, so the original stays in the tab. */
export async function getOriginalFileUrl(documentId: string): Promise<string> {
  return LOCAL ? local.fileUrl(documentId) : `${API_BASE}/processing/file/${documentId}`;
}

// ── Export ────────────────────────────────────────────────────────────────────

export async function exportCsv(documentIds?: string[]): Promise<Blob> {
  if (LOCAL) return local.exportCsv(documentIds);

  const response = await fetch(`${API_BASE}/export/csv`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document_ids: documentIds ?? null }),
  });

  if (!response.ok) {
    throw new ApiError('Export failed', response.status);
  }

  return response.blob();
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Tags ─────────────────────────────────────────────────────────────────────

export async function listTags(): Promise<Tag[]> {
  if (LOCAL) return local.listTags();
  return request<Tag[]>('/tags');
}

export async function createTag(name: string): Promise<Tag> {
  if (LOCAL) return local.createTag(name);
  return request<Tag>('/tags', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function deleteTag(tagId: string): Promise<void> {
  if (LOCAL) return local.deleteTag(tagId);
  await request(`/tags/${tagId}`, { method: 'DELETE' });
}

export async function addTagToDocument(documentId: string, tagName: string): Promise<void> {
  if (LOCAL) return local.addTagToDocument(documentId, tagName);
  await request(`/tags/documents/${documentId}`, {
    method: 'POST',
    body: JSON.stringify({ tag_name: tagName }),
  });
}

export async function removeTagFromDocument(documentId: string, tagId: string): Promise<void> {
  if (LOCAL) return local.removeTagFromDocument(documentId, tagId);
  await request(`/tags/documents/${documentId}/${tagId}`, { method: 'DELETE' });
}

// ── Settings ─────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<AppSettings> {
  if (LOCAL) return local.getSettings();
  return request<AppSettings>('/settings');
}
