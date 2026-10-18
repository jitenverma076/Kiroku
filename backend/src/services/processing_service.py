"""
Document processing service — orchestrates the import and extraction pipeline.

Pipeline stages:
  1. Validate file (type, size)
  2. Compute SHA-256 hash for duplicate detection
  3. Store file in managed file store
  4. Extract text (native PDF or OCR)
  5. Classify document type
  6. Extract structured fields
  7. Generate preview image
  8. Persist results to database

No remote services are used. All processing is local.
"""

from __future__ import annotations

import hashlib
import logging
import mimetypes
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from domain.models import (
    DocumentStatus, DuplicateInfo, ExtractionResult, FieldExtraction,
    ImportResponse,
)
from storage.models import Document, DocumentField
from storage.file_store import FileStore
from storage.database import get_session_factory
from document_processing.text_extractor import (
    extract_text, generate_pdf_preview, generate_image_preview,
)
from ai.classifier import classify_document
from ai.extractor import extract_fields

log = logging.getLogger("kiroku.processing")

# ── Allowed file types ────────────────────────────────────────────────────────
ALLOWED_EXTENSIONS = {
    ".pdf", ".jpg", ".jpeg", ".png", ".tiff", ".tif", ".webp", ".bmp"
}
ALLOWED_MIME_PREFIXES = {"application/pdf", "image/"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _compute_sha256(file_path: str) -> str:
    """Compute SHA-256 hash of a file for duplicate detection."""
    sha = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            sha.update(chunk)
    return sha.hexdigest()


def _detect_mime(file_path: str, filename: str) -> str:
    """Detect MIME type from extension (no network calls)."""
    ext = os.path.splitext(filename)[1].lower()
    if ext == ".pdf":
        return "application/pdf"
    mime, _ = mimetypes.guess_type(filename)
    return mime or "application/octet-stream"


def _validate_file(file_path: str, filename: str) -> tuple[bool, Optional[str]]:
    """Validate file type and size. Returns (valid, error_message)."""
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return False, f"Unsupported file type: {ext}. Accepted: PDF, JPEG, PNG, TIFF, WEBP"

    size = os.path.getsize(file_path)
    if size > MAX_FILE_SIZE:
        return False, f"File too large ({size / 1024 / 1024:.1f} MB). Maximum: 50 MB"

    if size == 0:
        return False, "File is empty"

    return True, None


def check_duplicate(db: Session, file_hash: str, filename: str) -> Optional[DuplicateInfo]:
    """
    Check for exact file duplicates via SHA-256 hash.

    Returns DuplicateInfo if a duplicate exists, None otherwise.
    """
    existing = db.query(Document).filter(Document.file_hash == file_hash).first()
    if existing:
        return DuplicateInfo(
            type="exact",
            existing_document_id=existing.id,
            existing_filename=existing.filename,
            reason=f"Identical file already imported as '{existing.filename}'",
        )
    return None


def check_probable_duplicate(
    db: Session, vendor: Optional[str], total: Optional[float], issue_date: Optional[str]
) -> Optional[DuplicateInfo]:
    """
    Check for probable business document duplicates.

    Criteria: same vendor + same total + issue date within ±7 days
    """
    if not vendor or total is None or not issue_date:
        return None

    from datetime import timedelta
    from dateutil import parser as dp
    try:
        target_date = dp.parse(issue_date)
    except Exception:
        return None

    date_from = (target_date - timedelta(days=7)).strftime("%Y-%m-%d")
    date_to   = (target_date + timedelta(days=7)).strftime("%Y-%m-%d")

    # Vendor match (case-insensitive, partial)
    similar = (
        db.query(Document)
        .filter(
            Document.vendor.ilike(f"%{vendor.split()[0] if vendor.split() else vendor}%"),
            Document.total_amount.between(total * 0.99, total * 1.01),
            Document.issue_date.between(date_from, date_to),
            Document.status != "error",
        )
        .first()
    )
    if similar:
        return DuplicateInfo(
            type="probable",
            existing_document_id=similar.id,
            existing_filename=similar.filename,
            reason=(
                f"Possible duplicate: similar vendor '{similar.vendor}', "
                f"same total {total}, date within 7 days"
            ),
        )
    return None


def _persist_document(
    db: Session,
    document_id: str,
    filename: str,
    file_path: str,
    file_hash: str,
    file_size: int,
    mime_type: str,
    extraction: ExtractionResult,
    preview_path: Optional[str],
) -> Document:
    """Persist a fully-processed document to the database."""
    now = _utcnow()

    # Map extraction to float values
    def to_float(fe: FieldExtraction) -> Optional[float]:
        if fe.value is None:
            return None
        try:
            return float(fe.value)
        except ValueError:
            return None

    status = "review_needed" if extraction.needs_review else "confirmed"

    doc = Document(
        id=document_id,
        filename=filename,
        file_path=file_path,
        file_hash=file_hash,
        file_size=file_size,
        mime_type=mime_type,
        status=status,
        doc_type=extraction.doc_type.value if extraction.doc_type.value else None,
        confidence=extraction.overall_confidence,
        vendor=extraction.vendor.value,
        doc_number=extraction.doc_number.value,
        issue_date=extraction.issue_date.value,
        due_date=extraction.due_date.value,
        currency=extraction.currency.value,
        subtotal=to_float(extraction.subtotal),
        tax_amount=to_float(extraction.tax_amount),
        total_amount=to_float(extraction.total_amount),
        payment_terms=extraction.payment_terms.value,
        raw_text=extraction.raw_text,
        notes=None,
        user_confirmed=False,
        error_message=None,
        imported_at=now,
        updated_at=now,
        preview_path=preview_path,
    )
    db.add(doc)

    # Persist per-field data
    field_data = {
        "vendor":        extraction.vendor,
        "doc_number":    extraction.doc_number,
        "issue_date":    extraction.issue_date,
        "due_date":      extraction.due_date,
        "currency":      extraction.currency,
        "subtotal":      extraction.subtotal,
        "tax_amount":    extraction.tax_amount,
        "total_amount":  extraction.total_amount,
        "payment_terms": extraction.payment_terms,
    }
    for field_name, fe in field_data.items():
        field = DocumentField(
            id=str(uuid.uuid4()),
            document_id=document_id,
            field_name=field_name,
            value=fe.value,
            confidence=fe.confidence,
            user_edited=fe.user_edited,
            created_at=now,
            updated_at=now,
        )
        db.add(field)

    db.commit()
    db.refresh(doc)
    return doc


def _create_error_document(
    db: Session,
    document_id: str,
    filename: str,
    file_path: str,
    file_hash: str,
    file_size: int,
    mime_type: str,
    error_message: str,
) -> Document:
    """Persist a document record with error status."""
    now = _utcnow()
    doc = Document(
        id=document_id,
        filename=filename,
        file_path=file_path,
        file_hash=file_hash,
        file_size=file_size,
        mime_type=mime_type,
        status="error",
        error_message=error_message,
        imported_at=now,
        updated_at=now,
    )
    db.add(doc)
    db.commit()
    return doc


def process_document(
    db: Session,
    temp_file_path: str,
    original_filename: str,
    skip_duplicate_check: bool = False,
) -> ImportResponse:
    """
    Full processing pipeline for an uploaded document.

    Returns ImportResponse indicating success, duplicate, or error.
    """
    document_id = str(uuid.uuid4())
    filename = original_filename

    # 1. Validate
    valid, error = _validate_file(temp_file_path, filename)
    if not valid:
        return ImportResponse(filename=filename, accepted=False, error=error)

    file_size = os.path.getsize(temp_file_path)
    mime_type = _detect_mime(temp_file_path, filename)
    file_hash = _compute_sha256(temp_file_path)

    # 2. Exact duplicate check
    if not skip_duplicate_check:
        dup = check_duplicate(db, file_hash, filename)
        if dup:
            return ImportResponse(
                filename=filename, accepted=False, duplicate=dup
            )

    # 3. Store in file store
    ext = os.path.splitext(filename)[1]
    try:
        stored_path = FileStore.store_document(document_id, temp_file_path, ext)
    except Exception as e:
        log.error("Failed to store document: %s", e)
        return ImportResponse(filename=filename, accepted=False, error=f"Storage error: {e}")

    # 4. Extract text
    try:
        text, extraction_method = extract_text(stored_path, mime_type)
        log.info("Text extracted via %s: %d chars", extraction_method, len(text))
    except Exception as e:
        log.error("Text extraction failed: %s", e)
        text = ""

    # 5. Classify
    try:
        doc_type, classification_confidence = classify_document(text)
    except Exception as e:
        log.error("Classification failed: %s", e)
        doc_type = "unknown"
        classification_confidence = 0.0

    # 6. Extract structured fields
    try:
        extraction = extract_fields(text, doc_type)
    except Exception as e:
        log.error("Field extraction failed: %s", e)
        extraction = ExtractionResult(
            doc_type=FieldExtraction(value=doc_type, confidence=classification_confidence),
            vendor=FieldExtraction(), doc_number=FieldExtraction(),
            issue_date=FieldExtraction(), due_date=FieldExtraction(),
            currency=FieldExtraction(), subtotal=FieldExtraction(),
            tax_amount=FieldExtraction(), total_amount=FieldExtraction(),
            payment_terms=FieldExtraction(),
            overall_confidence=0.0, needs_review=True, raw_text=text[:50000],
        )

    # 7. Generate preview
    preview_path = None
    try:
        if ext.lower() == ".pdf":
            preview_bytes = generate_pdf_preview(stored_path)
        else:
            preview_bytes = generate_image_preview(stored_path)

        if preview_bytes:
            preview_path = FileStore.store_preview(document_id, preview_bytes, page=0)
    except Exception as e:
        log.warning("Preview generation failed: %s", e)

    # 8. Probable duplicate check (after extraction)
    probable_dup = None
    if not skip_duplicate_check:
        try:
            probable_dup = check_probable_duplicate(
                db,
                extraction.vendor.value,
                float(extraction.total_amount.value) if extraction.total_amount.value else None,
                extraction.issue_date.value,
            )
        except Exception:
            pass

    # 9. Persist
    _persist_document(
        db=db,
        document_id=document_id,
        filename=filename,
        file_path=stored_path,
        file_hash=file_hash,
        file_size=file_size,
        mime_type=mime_type,
        extraction=extraction,
        preview_path=preview_path,
    )

    log.info("Processed document %s: type=%s, confidence=%.2f",
             document_id, doc_type, extraction.overall_confidence)

    return ImportResponse(
        document_id=document_id,
        filename=filename,
        accepted=True,
        duplicate=probable_dup,
    )


def reprocess_document(db: Session, document_id: str) -> bool:
    """
    Re-run extraction on an existing document.

    User-edited fields are NOT overwritten.
    """
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc or not doc.file_path or not os.path.exists(doc.file_path):
        return False

    # Get user-edited fields to preserve
    user_edited_fields = {
        f.field_name: f.value
        for f in doc.fields
        if f.user_edited
    }

    # Re-extract text
    text, _ = extract_text(doc.file_path, doc.mime_type)
    doc_type, _ = classify_document(text)
    extraction = extract_fields(text, doc_type)

    now = _utcnow()

    # Update document — respecting user edits
    doc.status = "review_needed" if extraction.needs_review else "confirmed"
    doc.doc_type = doc_type
    doc.confidence = extraction.overall_confidence

    if "vendor" not in user_edited_fields:
        doc.vendor = extraction.vendor.value
    if "doc_number" not in user_edited_fields:
        doc.doc_number = extraction.doc_number.value
    if "total_amount" not in user_edited_fields:
        val = extraction.total_amount.value
        doc.total_amount = float(val) if val else None

    doc.updated_at = now
    db.commit()
    return True
