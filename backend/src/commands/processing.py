"""
Document processing API routes — file upload and processing pipeline.
"""

from __future__ import annotations

import logging
import os
import tempfile
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from domain.models import ImportResponse
from services.processing_service import process_document, reprocess_document
from storage.database import get_db
from storage.file_store import FileStore
from document_processing.text_extractor import get_capabilities

log = logging.getLogger("kiroku.routes.processing")
router = APIRouter()

# Maximum upload size (enforced at route level as well)
MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB


@router.post("/upload", response_model=ImportResponse)
async def upload_document(
    file: UploadFile = File(...),
    skip_duplicate_check: bool = Form(False),
    db: Session = Depends(get_db),
):
    """
    Upload and process a single document.

    The file is temporarily stored, validated, then processed through
    the full local OCR/AI extraction pipeline.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    # Read file content with size limit
    content = await file.read(MAX_UPLOAD_SIZE + 1)
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is 50 MB."
        )
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    # Write to a secure temp file
    suffix = os.path.splitext(file.filename)[1]
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = process_document(
            db=db,
            temp_file_path=tmp_path,
            original_filename=file.filename,
            skip_duplicate_check=skip_duplicate_check,
        )
    finally:
        # Always clean up temp file
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    return result


@router.post("/{document_id}/reprocess")
def reprocess(document_id: str, db: Session = Depends(get_db)):
    """Re-run extraction on an existing document (preserves user edits)."""
    success = reprocess_document(db, document_id)
    if not success:
        raise HTTPException(
            status_code=404,
            detail="Document not found or original file missing"
        )
    return {"reprocessed": True, "document_id": document_id}


@router.get("/capabilities")
def capabilities():
    """Return the current OCR/processing capabilities."""
    caps = get_capabilities()
    return {
        "capabilities": caps,
        "notes": {
            "pdfplumber": "Native PDF text extraction (no OCR needed for text PDFs)",
            "tesseract_ocr": "Required for scanned documents and image files",
            "pdf_preview": "Requires poppler system library (brew install poppler)",
        }
    }


@router.get("/preview/{document_id}")
def get_preview(document_id: str):
    """Serve the preview image for a document."""
    preview_dir = FileStore.preview_dir(document_id)
    preview_path = os.path.join(preview_dir, "page_0.jpg")

    if not os.path.exists(preview_path):
        raise HTTPException(status_code=404, detail="Preview not available")

    # Validate path is within allowed directory
    try:
        FileStore._validate_safe_path(preview_path, FileStore.previews_dir())
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid path")

    return FileResponse(preview_path, media_type="image/jpeg")


@router.get("/file/{document_id}")
def get_original_file(document_id: str):
    """Serve the original document file."""
    file_path = FileStore.get_document_path(document_id)
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Original file not found")

    try:
        FileStore._validate_safe_path(file_path, FileStore.documents_dir())
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid path")

    return FileResponse(file_path)
