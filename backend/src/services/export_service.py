"""
CSV export service for Kiroku.

Export schema:
  id, type, vendor, doc_number, issue_date, due_date, currency,
  subtotal, tax_amount, total, status, tags, imported_at

Encoding: UTF-8 with BOM (for Excel compatibility)
Dates: ISO 8601 (YYYY-MM-DD)
Missing values: empty string (not NULL)
"""

from __future__ import annotations

import csv
import io
import logging
from typing import Optional

from sqlalchemy.orm import Session, joinedload

from storage.models import Document, DocumentTag, Tag

log = logging.getLogger("kiroku.export")

CSV_COLUMNS = [
    "id", "type", "vendor", "doc_number", "issue_date", "due_date",
    "currency", "subtotal", "tax_amount", "total", "status",
    "tags", "imported_at",
]


def _safe_str(value) -> str:
    """Convert a value to string, using empty string for None."""
    if value is None:
        return ""
    return str(value)


def _format_amount(value: Optional[float]) -> str:
    """Format a monetary amount consistently, empty string if None."""
    if value is None:
        return ""
    return f"{value:.2f}"


def _doc_to_row(doc: Document) -> dict:
    """Convert a Document ORM instance to a CSV row dict."""
    tags = "|".join(sorted(dt.tag.name for dt in doc.document_tags))
    return {
        "id":          doc.id,
        "type":        _safe_str(doc.doc_type),
        "vendor":      _safe_str(doc.vendor),
        "doc_number":  _safe_str(doc.doc_number),
        "issue_date":  _safe_str(doc.issue_date),
        "due_date":    _safe_str(doc.due_date),
        "currency":    _safe_str(doc.currency),
        "subtotal":    _format_amount(doc.subtotal),
        "tax_amount":  _format_amount(doc.tax_amount),
        "total":       _format_amount(doc.total_amount),
        "status":      _safe_str(doc.status),
        "tags":        tags,
        "imported_at": _safe_str(doc.imported_at),
    }


def export_documents(
    db: Session,
    document_ids: Optional[list[str]] = None,
) -> bytes:
    """
    Generate a UTF-8 (with BOM) CSV export of documents.

    Args:
        db: Database session
        document_ids: List of IDs to export; if None, exports all documents

    Returns:
        CSV content as bytes (UTF-8 with BOM for Excel compatibility)
    """
    q = db.query(Document).options(
        joinedload(Document.document_tags).joinedload(DocumentTag.tag)
    ).filter(Document.status != "processing")

    if document_ids:
        q = q.filter(Document.id.in_(document_ids))

    docs = q.order_by(Document.imported_at.desc()).all()

    buf = io.StringIO()
    writer = csv.DictWriter(
        buf,
        fieldnames=CSV_COLUMNS,
        extrasaction="ignore",
        quoting=csv.QUOTE_ALL,
        lineterminator="\r\n",
    )
    writer.writeheader()
    for doc in docs:
        writer.writerow(_doc_to_row(doc))

    csv_str = buf.getvalue()
    # UTF-8 BOM for Excel compatibility
    return ("\ufeff" + csv_str).encode("utf-8")
