"""
Database initialization and session management.

Uses SQLite with WAL mode for concurrent access safety.
Database location: data/data.db
"""

import logging
import os

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, Session

from storage.models import Base
from storage.file_store import FileStore

log = logging.getLogger("kiroku.db")


def get_db_path() -> str:
    return os.path.join(FileStore.data_dir(), "data.db")


def create_db_engine():
    db_path = get_db_path()
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    db_url = f"sqlite:///{db_path}"
    log.info("Database path: %s", db_path)

    engine = create_engine(
        db_url,
        connect_args={
            "check_same_thread": False,
            "timeout": 30,
        },
        echo=False,
    )

    # Enable WAL mode and foreign keys for each connection
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()

    return engine


# Module-level singletons
_engine = None
_SessionLocal = None


def get_engine():
    global _engine
    if _engine is None:
        _engine = create_db_engine()
    return _engine


def get_session_factory():
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(
            autocommit=False,
            autoflush=False,
            bind=get_engine(),
        )
    return _SessionLocal


def init_db():
    """Create all tables if they don't exist (initial setup)."""
    engine = get_engine()
    Base.metadata.create_all(bind=engine)
    log.info("Database schema initialized.")


def get_db() -> Session:
    """FastAPI dependency: yields a database session."""
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
