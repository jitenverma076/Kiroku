"""
Domain models for Kiroku.

Pydantic models define the API contract.
Enums define valid values enforced throughout the system.
"""

from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator


# ── Enumerations ──────────────────────────────────────────────────────────────

class DocumentType(str, enum.Enum):
    INVOICE = "invoice"
    RECEIPT = "receipt"
    BILL = "bill"
    CREDIT_NOTE = "credit_note"
    UNKNOWN = "unknown"


class DocumentStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    REVIEW_NEEDED = "review_needed"
    CONFIRMED = "confirmed"
    ERROR = "error"


# ── Extraction result schemas ─────────────────────────────────────────────────

class FieldExtraction(BaseModel):
    """Represents a single extracted field with its confidence score."""
    value: Optional[str] = None
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    user_edited: bool = False


class ExtractionResult(BaseModel):
    """Complete extraction result from the AI/OCR pipeline."""
    doc_type: FieldExtraction
    vendor: FieldExtraction
    doc_number: FieldExtraction
    issue_date: FieldExtraction
    due_date: FieldExtraction
    currency: FieldExtraction
    subtotal: FieldExtraction
    tax_amount: FieldExtraction
    total_amount: FieldExtraction
    payment_terms: FieldExtraction
    overall_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    needs_review: bool = False
    raw_text: str = ""


# ── API request / response models ────────────────────────────────────────────

class TagModel(BaseModel):
    id: str
    name: str


class DocumentFieldModel(BaseModel):
    id: str
    field_name: str
    value: Optional[str]
    confidence: float
    user_edited: bool


class DocumentSummary(BaseModel):
    """Lightweight model for list views."""
    id: str
    filename: str
    status: DocumentStatus
    doc_type: Optional[DocumentType]
    vendor: Optional[str]
    doc_number: Optional[str]
    issue_date: Optional[str]
    total_amount: Optional[float]
    currency: Optional[str]
    confidence: Optional[float]
    user_confirmed: bool
    imported_at: str
    preview_path: Optional[str]
    tags: list[TagModel] = []
    error_message: Optional[str]


class DocumentDetail(DocumentSummary):
    """Full model for detail views and editing."""
    due_date: Optional[str]
    subtotal: Optional[float]
    tax_amount: Optional[float]
    payment_terms: Optional[str]
    notes: Optional[str]
    file_size: int
    mime_type: str
    file_hash: str
    fields: list[DocumentFieldModel] = []
    updated_at: str


class DocumentUpdate(BaseModel):
    """Fields that the user can edit."""
    doc_type: Optional[DocumentType] = None
    vendor: Optional[str] = None
    doc_number: Optional[str] = None
    issue_date: Optional[str] = None
    due_date: Optional[str] = None
    currency: Optional[str] = None
    subtotal: Optional[float] = None
    tax_amount: Optional[float] = None
    total_amount: Optional[float] = None
    payment_terms: Optional[str] = None
    notes: Optional[str] = None
    user_confirmed: Optional[bool] = None


class DocumentListResponse(BaseModel):
    documents: list[DocumentSummary]
    total: int
    page: int
    page_size: int
    total_pages: int


class ProcessingStatus(BaseModel):
    document_id: str
    status: DocumentStatus
    progress_message: str
    error_message: Optional[str] = None


class DuplicateInfo(BaseModel):
    type: str  # "exact" | "probable"
    existing_document_id: str
    existing_filename: str
    reason: str


class ImportResponse(BaseModel):
    # Needs an explicit default: duplicate and rejected uploads build this
    # without a document_id, and in Pydantic v2 Optional alone still means required.
    document_id: Optional[str] = None
    filename: str
    accepted: bool
    duplicate: Optional[DuplicateInfo] = None
    error: Optional[str] = None


class ExportRequest(BaseModel):
    document_ids: Optional[list[str]] = None  # None = export all
    filters: Optional[dict] = None


class SearchFilters(BaseModel):
    query: Optional[str] = None
    doc_type: Optional[DocumentType] = None
    status: Optional[DocumentStatus] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    amount_min: Optional[float] = None
    amount_max: Optional[float] = None
    currency: Optional[str] = None
    tags: Optional[list[str]] = None
    sort_by: str = "imported_at"
    sort_dir: str = "desc"
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)


if __name__ == "__main__":  # python -m domain.models
    # The duplicate and rejection paths construct this without a document_id.
    assert ImportResponse(filename="a.pdf", accepted=False).document_id is None
    assert ImportResponse(
        filename="a.pdf",
        accepted=False,
        duplicate=DuplicateInfo(
            type="exact", existing_document_id="x",
            existing_filename="a.pdf", reason="same file",
        ),
    ).duplicate.type == "exact"
    print("ImportResponse partial construction: ok")
