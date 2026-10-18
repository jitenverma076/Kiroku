// Shared types, mirroring the Pydantic models in backend/src/domain/models.py

export type DocumentType = 'invoice' | 'receipt' | 'bill' | 'credit_note' | 'unknown';

export type DocumentStatus = 'pending' | 'processing' | 'review_needed' | 'confirmed' | 'error';

export interface Tag {
  id: string;
  name: string;
  document_count?: number;
}

export interface DocumentField {
  id: string;
  field_name: string;
  value: string | null;
  confidence: number;
  user_edited: boolean;
}

export interface DocumentSummary {
  id: string;
  filename: string;
  status: DocumentStatus;
  doc_type: DocumentType | null;
  vendor: string | null;
  doc_number: string | null;
  issue_date: string | null;
  total_amount: number | null;
  currency: string | null;
  confidence: number | null;
  user_confirmed: boolean;
  imported_at: string;
  preview_path: string | null;
  tags: Tag[];
  error_message: string | null;
}

export interface DocumentDetail extends DocumentSummary {
  due_date: string | null;
  subtotal: number | null;
  tax_amount: number | null;
  payment_terms: string | null;
  notes: string | null;
  file_size: number;
  mime_type: string;
  file_hash: string;
  fields: DocumentField[];
  updated_at: string;
}

export interface DocumentListResponse {
  documents: DocumentSummary[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface DocumentUpdate {
  doc_type?: DocumentType;
  vendor?: string;
  doc_number?: string;
  issue_date?: string;
  due_date?: string;
  currency?: string;
  subtotal?: number;
  tax_amount?: number;
  total_amount?: number;
  payment_terms?: string;
  notes?: string;
  user_confirmed?: boolean;
}

export interface DuplicateInfo {
  type: 'exact' | 'probable';
  existing_document_id: string;
  existing_filename: string;
  reason: string;
}

export interface ImportResponse {
  document_id?: string;
  filename: string;
  accepted: boolean;
  duplicate?: DuplicateInfo;
  error?: string;
}

export interface SearchFilters {
  query?: string;
  doc_type?: DocumentType;
  status?: DocumentStatus;
  date_from?: string;
  date_to?: string;
  amount_min?: number;
  amount_max?: number;
  currency?: string;
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
  page?: number;
  page_size?: number;
}

export interface AppCapabilities {
  pdfplumber: boolean;
  tesseract_ocr: boolean;
  pdf_preview: boolean;
}

export interface AppSettings {
  app: {
    name: string;
    version: string;
  };
  storage: {
    total_files: number;
    total_bytes: number;
  };
  capabilities: AppCapabilities;
}

export interface Stats {
  total_documents: number;
  by_status: Record<string, number>;
  total_value: number;
}

export interface UploadProgress {
  file: File;
  status: 'queued' | 'uploading' | 'processing' | 'done' | 'error' | 'duplicate';
  result?: ImportResponse;
  error?: string;
}
