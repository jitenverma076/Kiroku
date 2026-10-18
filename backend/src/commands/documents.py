"""
Document API routes — thin handlers that delegate to the document service.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from domain.models import (
    DocumentDetail, DocumentListResponse, DocumentStatus,
    DocumentType, DocumentUpdate, SearchFilters,
)
from services.document_service import (
    delete_document, get_document, get_review_queue, get_stats,
    list_documents, update_document,
)
from storage.database import get_db

log = logging.getLogger("kiroku.routes.documents")
router = APIRouter()


@router.get("", response_model=DocumentListResponse)
def list_docs(
    query: Optional[str] = Query(None),
    doc_type: Optional[DocumentType] = Query(None),
    status: Optional[DocumentStatus] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    amount_min: Optional[float] = Query(None),
    amount_max: Optional[float] = Query(None),
    currency: Optional[str] = Query(None),
    sort_by: str = Query("imported_at"),
    sort_dir: str = Query("desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """List documents with optional filters, sorting, and pagination."""
    valid_sort_cols = {
        "imported_at", "issue_date", "total_amount", "vendor", "doc_type", "status"
    }
    if sort_by not in valid_sort_cols:
        sort_by = "imported_at"
    if sort_dir not in ("asc", "desc"):
        sort_dir = "desc"

    filters = SearchFilters(
        query=query, doc_type=doc_type, status=status,
        date_from=date_from, date_to=date_to,
        amount_min=amount_min, amount_max=amount_max,
        currency=currency, sort_by=sort_by, sort_dir=sort_dir,
        page=page, page_size=page_size,
    )
    return list_documents(db, filters)


@router.get("/review-queue")
def review_queue(db: Session = Depends(get_db)):
    """Return all documents needing human review."""
    return get_review_queue(db)


@router.get("/stats")
def stats(db: Session = Depends(get_db)):
    """Return document statistics."""
    return get_stats(db)


@router.get("/{document_id}", response_model=DocumentDetail)
def get_doc(document_id: str, db: Session = Depends(get_db)):
    """Get full document detail including all extracted fields."""
    doc = get_document(db, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.patch("/{document_id}", response_model=DocumentDetail)
def update_doc(
    document_id: str,
    update: DocumentUpdate,
    db: Session = Depends(get_db),
):
    """Update document fields (user edits)."""
    doc = update_document(db, document_id, update)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.delete("/{document_id}")
def delete_doc(document_id: str, db: Session = Depends(get_db)):
    """Delete a document and all associated files. Irreversible."""
    success = delete_document(db, document_id)
    if not success:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"deleted": True, "document_id": document_id}


@router.delete("")
def bulk_delete(document_ids: list[str], db: Session = Depends(get_db)):
    """Delete multiple documents. Requires explicit list of IDs."""
    results = []
    for doc_id in document_ids:
        success = delete_document(db, doc_id)
        results.append({"document_id": doc_id, "deleted": success})
    return {"results": results}
