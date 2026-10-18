"""
CSV export API route.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from services.export_service import export_documents
from storage.database import get_db

log = logging.getLogger("kiroku.routes.export")
router = APIRouter()


class ExportRequest(BaseModel):
    document_ids: Optional[list[str]] = None


@router.post("/csv")
def export_csv(
    request: ExportRequest,
    db: Session = Depends(get_db),
):
    """
    Export documents to CSV.

    If document_ids is provided, exports only those documents.
    Otherwise, exports all non-processing documents.
    """
    csv_bytes = export_documents(db, document_ids=request.document_ids)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"kiroku_export_{timestamp}.csv"

    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(csv_bytes)),
        },
    )


@router.get("/csv")
def export_csv_get(db: Session = Depends(get_db)):
    """Export all documents to CSV (GET variant for direct link downloads)."""
    csv_bytes = export_documents(db, document_ids=None)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"kiroku_export_{timestamp}.csv"

    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )
