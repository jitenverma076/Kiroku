"""
Tags API routes.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from storage.models import DocumentTag, Tag
from storage.database import get_db

log = logging.getLogger("kiroku.routes.tags")
router = APIRouter()


class TagCreate(BaseModel):
    name: str


class TagResponse(BaseModel):
    id: str
    name: str
    document_count: int = 0


class AddTagRequest(BaseModel):
    tag_name: str


@router.get("", response_model=list[TagResponse])
def list_tags(db: Session = Depends(get_db)):
    """List all tags with document counts."""
    from sqlalchemy import func
    tags = (
        db.query(
            Tag.id, Tag.name,
            func.count(DocumentTag.document_id).label("document_count")
        )
        .outerjoin(DocumentTag, Tag.id == DocumentTag.tag_id)
        .group_by(Tag.id)
        .all()
    )
    return [TagResponse(id=t.id, name=t.name, document_count=t.document_count) for t in tags]


@router.post("", response_model=TagResponse)
def create_tag(tag: TagCreate, db: Session = Depends(get_db)):
    """Create a new tag."""
    tag_name = tag.name.strip()
    if not tag_name:
        raise HTTPException(status_code=400, detail="Tag name cannot be empty")
    if len(tag_name) > 50:
        raise HTTPException(status_code=400, detail="Tag name too long (max 50 chars)")

    existing = db.query(Tag).filter(Tag.name == tag_name).first()
    if existing:
        return TagResponse(id=existing.id, name=existing.name)

    new_tag = Tag(id=str(uuid.uuid4()), name=tag_name)
    db.add(new_tag)
    db.commit()
    return TagResponse(id=new_tag.id, name=new_tag.name)


@router.delete("/{tag_id}")
def delete_tag(tag_id: str, db: Session = Depends(get_db)):
    """Delete a tag (removes from all documents)."""
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    db.delete(tag)
    db.commit()
    return {"deleted": True}


@router.post("/documents/{document_id}")
def add_tag_to_document(
    document_id: str,
    request: AddTagRequest,
    db: Session = Depends(get_db),
):
    """Add a tag to a document (creates tag if it doesn't exist)."""
    from storage.models import Document
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    tag_name = request.tag_name.strip()
    tag = db.query(Tag).filter(Tag.name == tag_name).first()
    if not tag:
        tag = Tag(id=str(uuid.uuid4()), name=tag_name)
        db.add(tag)
        db.flush()

    # Check if already tagged
    existing_link = (
        db.query(DocumentTag)
        .filter(DocumentTag.document_id == document_id, DocumentTag.tag_id == tag.id)
        .first()
    )
    if not existing_link:
        link = DocumentTag(document_id=document_id, tag_id=tag.id)
        db.add(link)
        db.commit()

    return {"tagged": True, "tag": {"id": tag.id, "name": tag.name}}


@router.delete("/documents/{document_id}/{tag_id}")
def remove_tag_from_document(
    document_id: str,
    tag_id: str,
    db: Session = Depends(get_db),
):
    """Remove a tag from a document."""
    link = (
        db.query(DocumentTag)
        .filter(DocumentTag.document_id == document_id, DocumentTag.tag_id == tag_id)
        .first()
    )
    if not link:
        raise HTTPException(status_code=404, detail="Tag not found on document")
    db.delete(link)
    db.commit()
    return {"removed": True}
