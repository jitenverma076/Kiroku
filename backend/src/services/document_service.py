"""
Document service — CRUD operations and business logic for document records.

Handles:
- Document retrieval with filtering, sorting, pagination
- Document updates (user field edits)
- Document deletion with file cleanup
- Tag management
"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import or_, func
from sqlalchemy.orm import Session, joinedload

from domain.models import (
    DocumentDetail, DocumentFieldModel, DocumentListResponse,
    DocumentStatus, DocumentSummary, DocumentType, DocumentUpdate,
    SearchFilters, TagModel,
)
from storage.models import Document, DocumentField, DocumentTag, Tag
from storage.file_store import FileStore

log = logging.getLogger("kiroku.document_service")


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _doc_to_summary(doc: Document) -> DocumentSummary:
    tags = [TagModel(id=dt.tag.id, name=dt.tag.name) for dt in doc.document_tags]
    return DocumentSummary(
        id=doc.id,
        filename=doc.filename,
        status=DocumentStatus(doc.status),
        doc_type=DocumentType(doc.doc_type) if doc.doc_type else None,
        vendor=doc.vendor,
        doc_number=doc.doc_number,
        issue_date=doc.issue_date,
        total_amount=doc.total_amount,
        currency=doc.currency,
        confidence=doc.confidence,
        user_confirmed=doc.user_confirmed,
        imported_at=doc.imported_at,
        preview_path=doc.preview_path,
        tags=tags,
        error_message=doc.error_message,
    )


def _doc_to_detail(doc: Document) -> DocumentDetail:
    tags = [TagModel(id=dt.tag.id, name=dt.tag.name) for dt in doc.document_tags]
    fields = [
        DocumentFieldModel(
            id=f.id,
            field_name=f.field_name,
            value=f.value,
            confidence=f.confidence or 0.0,
            user_edited=f.user_edited,
        )
        for f in doc.fields
    ]
    return DocumentDetail(
        id=doc.id, filename=doc.filename,
        status=DocumentStatus(doc.status),
        doc_type=DocumentType(doc.doc_type) if doc.doc_type else None,
        vendor=doc.vendor, doc_number=doc.doc_number,
        issue_date=doc.issue_date, due_date=doc.due_date,
        total_amount=doc.total_amount, subtotal=doc.subtotal,
        tax_amount=doc.tax_amount, currency=doc.currency,
        payment_terms=doc.payment_terms, notes=doc.notes,
        confidence=doc.confidence, user_confirmed=doc.user_confirmed,
        imported_at=doc.imported_at, updated_at=doc.updated_at,
        preview_path=doc.preview_path, tags=tags, fields=fields,
        error_message=doc.error_message,
        file_size=doc.file_size,
        mime_type=doc.mime_type,
        file_hash=doc.file_hash,
    )


def list_documents(db: Session, filters: SearchFilters) -> DocumentListResponse:
    """Return paginated, filtered, sorted document list."""
    q = (
        db.query(Document)
        .options(joinedload(Document.document_tags).joinedload(DocumentTag.tag))
    )

    # Text search
    if filters.query:
        search_term = f"%{filters.query}%"
        q = q.filter(or_(
            Document.vendor.ilike(search_term),
            Document.doc_number.ilike(search_term),
            Document.notes.ilike(search_term),
        ))

    # Filters
    if filters.doc_type:
        q = q.filter(Document.doc_type == filters.doc_type.value)
    if filters.status:
        q = q.filter(Document.status == filters.status.value)
    if filters.date_from:
        q = q.filter(Document.issue_date >= filters.date_from)
    if filters.date_to:
        q = q.filter(Document.issue_date <= filters.date_to)
    if filters.amount_min is not None:
        q = q.filter(Document.total_amount >= filters.amount_min)
    if filters.amount_max is not None:
        q = q.filter(Document.total_amount <= filters.amount_max)
    if filters.currency:
        q = q.filter(Document.currency == filters.currency.upper())
    if filters.tags:
        for tag_name in filters.tags:
            q = q.filter(Document.document_tags.any(
                DocumentTag.tag.has(Tag.name == tag_name)
            ))

    total = q.count()

    # Sorting
    sort_col = getattr(Document, filters.sort_by, Document.imported_at)
    if filters.sort_dir == "asc":
        q = q.order_by(sort_col.asc())
    else:
        q = q.order_by(sort_col.desc())

    # Pagination
    offset = (filters.page - 1) * filters.page_size
    docs = q.offset(offset).limit(filters.page_size).all()

    total_pages = math.ceil(total / filters.page_size) if total > 0 else 1
    return DocumentListResponse(
        documents=[_doc_to_summary(d) for d in docs],
        total=total,
        page=filters.page,
        page_size=filters.page_size,
        total_pages=total_pages,
    )


def get_document(db: Session, document_id: str) -> Optional[DocumentDetail]:
    """Return full document detail or None if not found."""
    doc = (
        db.query(Document)
        .options(
            joinedload(Document.fields),
            joinedload(Document.document_tags).joinedload(DocumentTag.tag),
        )
        .filter(Document.id == document_id)
        .first()
    )
    return _doc_to_detail(doc) if doc else None


def update_document(db: Session, document_id: str, update: DocumentUpdate) -> Optional[DocumentDetail]:
    """
    Apply user edits to a document record.

    User edits are tracked — re-processing will not overwrite user-edited fields.
    """
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        return None

    updated = False
    if update.doc_type is not None:
        doc.doc_type = update.doc_type.value; updated = True
    if update.vendor is not None:
        doc.vendor = update.vendor; updated = True
        _update_field_user_edit(db, document_id, "vendor", update.vendor)
    if update.doc_number is not None:
        doc.doc_number = update.doc_number; updated = True
        _update_field_user_edit(db, document_id, "doc_number", update.doc_number)
    if update.issue_date is not None:
        doc.issue_date = update.issue_date; updated = True
    if update.due_date is not None:
        doc.due_date = update.due_date; updated = True
    if update.currency is not None:
        doc.currency = update.currency.upper(); updated = True
    if update.subtotal is not None:
        doc.subtotal = update.subtotal; updated = True
        _update_field_user_edit(db, document_id, "subtotal", str(update.subtotal))
    if update.tax_amount is not None:
        doc.tax_amount = update.tax_amount; updated = True
        _update_field_user_edit(db, document_id, "tax_amount", str(update.tax_amount))
    if update.total_amount is not None:
        doc.total_amount = update.total_amount; updated = True
        _update_field_user_edit(db, document_id, "total_amount", str(update.total_amount))
    if update.payment_terms is not None:
        doc.payment_terms = update.payment_terms; updated = True
    if update.notes is not None:
        doc.notes = update.notes; updated = True
    if update.user_confirmed is not None:
        doc.user_confirmed = update.user_confirmed; updated = True
        if update.user_confirmed and doc.status == "review_needed":
            doc.status = "confirmed"

    if updated:
        doc.updated_at = _utcnow()
        db.commit()
        db.refresh(doc)

    return get_document(db, document_id)


def _update_field_user_edit(db: Session, document_id: str, field_name: str, value: str):
    """Mark a field as user-edited in the document_fields table."""
    field = (
        db.query(DocumentField)
        .filter(DocumentField.document_id == document_id,
                DocumentField.field_name == field_name)
        .first()
    )
    if field:
        field.value = value
        field.user_edited = True
        field.confidence = 1.0
        field.updated_at = _utcnow()


def delete_document(db: Session, document_id: str) -> bool:
    """
    Delete a document record and all associated files.

    This is irreversible. Original files are deleted from the file store.
    """
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        return False

    # Delete files first
    try:
        FileStore.delete_document(document_id)
    except Exception as e:
        log.error("Error deleting files for document %s: %s", document_id, e)

    db.delete(doc)
    db.commit()
    log.info("Deleted document: %s", document_id)
    return True


def get_review_queue(db: Session) -> list[DocumentSummary]:
    """Return all documents needing review."""
    docs = (
        db.query(Document)
        .options(joinedload(Document.document_tags).joinedload(DocumentTag.tag))
        .filter(Document.status == "review_needed")
        .order_by(Document.imported_at.desc())
        .all()
    )
    return [_doc_to_summary(d) for d in docs]


def get_stats(db: Session) -> dict:
    """Return summary statistics for the settings/dashboard view."""
    total    = db.query(func.count(Document.id)).scalar()
    by_status = {}
    for status_val in ["pending", "processing", "review_needed", "confirmed", "error"]:
        count = db.query(func.count(Document.id)).filter(
            Document.status == status_val
        ).scalar()
        by_status[status_val] = count

    total_value = db.query(func.sum(Document.total_amount)).scalar() or 0.0
    return {
        "total_documents": total,
        "by_status": by_status,
        "total_value": round(float(total_value), 2),
    }
