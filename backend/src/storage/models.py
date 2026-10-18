"""
SQLAlchemy ORM models for Kiroku.

Tables:
  - documents: Core document records
  - document_fields: Per-field extraction data with confidence
  - tags: Unique tag definitions
  - document_tags: Many-to-many join table
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    Boolean, Column, Float, ForeignKey, Index, Integer,
    String, Text, UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, relationship


def utcnow_str() -> str:
    return datetime.now(timezone.utc).isoformat()


class Base(DeclarativeBase):
    pass


class Document(Base):
    __tablename__ = "documents"

    id            = Column(String, primary_key=True)
    filename      = Column(String, nullable=False)
    file_path     = Column(String, nullable=False)
    file_hash     = Column(String, nullable=False, unique=True, index=True)
    file_size     = Column(Integer, nullable=False)
    mime_type     = Column(String, nullable=False)
    status        = Column(String, nullable=False, default="pending", index=True)
    doc_type      = Column(String, nullable=True, index=True)
    confidence    = Column(Float, nullable=True)

    # Extracted / editable fields
    vendor        = Column(String, nullable=True, index=True)
    doc_number    = Column(String, nullable=True)
    issue_date    = Column(String, nullable=True, index=True)
    due_date      = Column(String, nullable=True)
    currency      = Column(String, nullable=True)
    subtotal      = Column(Float, nullable=True)
    tax_amount    = Column(Float, nullable=True)
    total_amount  = Column(Float, nullable=True)
    payment_terms = Column(String, nullable=True)

    raw_text      = Column(Text, nullable=True)
    notes         = Column(Text, nullable=True)
    user_confirmed = Column(Boolean, nullable=False, default=False)
    error_message = Column(String, nullable=True)
    imported_at   = Column(String, nullable=False)
    updated_at    = Column(String, nullable=False)
    preview_path  = Column(String, nullable=True)

    # Relationships
    fields        = relationship("DocumentField", back_populates="document",
                                 cascade="all, delete-orphan")
    document_tags = relationship("DocumentTag", back_populates="document",
                                 cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_documents_status", "status"),
        Index("idx_documents_doc_type", "doc_type"),
        Index("idx_documents_vendor", "vendor"),
        Index("idx_documents_issue_date", "issue_date"),
        Index("idx_documents_imported_at", "imported_at"),
    )


class DocumentField(Base):
    __tablename__ = "document_fields"

    id          = Column(String, primary_key=True)
    document_id = Column(String, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    field_name  = Column(String, nullable=False)
    value       = Column(String, nullable=True)
    confidence  = Column(Float, nullable=True)
    user_edited = Column(Boolean, nullable=False, default=False)
    created_at  = Column(String, nullable=False)
    updated_at  = Column(String, nullable=False)

    document = relationship("Document", back_populates="fields")

    __table_args__ = (
        Index("idx_fields_document_id", "document_id"),
        UniqueConstraint("document_id", "field_name", name="uq_field_per_doc"),
    )


class Tag(Base):
    __tablename__ = "tags"

    id   = Column(String, primary_key=True)
    name = Column(String, nullable=False, unique=True)

    document_tags = relationship("DocumentTag", back_populates="tag",
                                 cascade="all, delete-orphan")


class DocumentTag(Base):
    __tablename__ = "document_tags"

    document_id = Column(String, ForeignKey("documents.id", ondelete="CASCADE"),
                         primary_key=True)
    tag_id      = Column(String, ForeignKey("tags.id", ondelete="CASCADE"),
                         primary_key=True)

    document = relationship("Document", back_populates="document_tags")
    tag      = relationship("Tag", back_populates="document_tags")
