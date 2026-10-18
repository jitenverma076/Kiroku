"""Settings route — app version, storage usage, and optional-dependency status."""

from __future__ import annotations

import logging
import os

from fastapi import APIRouter

from storage.file_store import FileStore
from document_processing.text_extractor import get_capabilities

log = logging.getLogger("kiroku.routes.settings")
router = APIRouter()

APP_VERSION = "1.0.0"


def _storage_usage() -> tuple[int, int]:
    """Return (file count, total bytes) for the managed document directory."""
    docs_dir = FileStore.documents_dir()
    count = 0
    total = 0
    for root, _dirs, files in os.walk(docs_dir):
        for name in files:
            count += 1
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
    return count, total


@router.get("")
def get_settings():
    """Return the small amount of state the settings screen renders.

    Filesystem paths are deliberately omitted — they disclose the account name
    of whoever is running the app and nothing in the UI needs them.
    """
    total_files, total_bytes = _storage_usage()
    return {
        "app": {"name": "Kiroku", "version": APP_VERSION},
        "storage": {"total_files": total_files, "total_bytes": total_bytes},
        "capabilities": get_capabilities(),
    }
