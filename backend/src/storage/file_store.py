"""
File store management for Kiroku.

Manages the local directory structure for:
  - Original document files
  - Generated preview images

Storage root: data/
  documents/{document_id}/original.{ext}
  previews/{document_id}/page_0.jpg
"""

import logging
import os
import platform
import shutil

log = logging.getLogger("kiroku.filestore")


class FileStore:
    """Manages the local file storage for Kiroku."""

    @staticmethod
    def data_dir() -> str:
        """Return the application data directory."""
        env_dir = os.environ.get("KIROKU_DATA_DIR")
        if env_dir:
            return os.path.abspath(env_dir)

        # Default to project data directory
        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
        return os.path.join(project_root, "data")

    @staticmethod
    def documents_dir() -> str:
        return os.path.join(FileStore.data_dir(), "documents")

    @staticmethod
    def previews_dir() -> str:
        return os.path.join(FileStore.data_dir(), "previews")

    @staticmethod
    def ensure_directories():
        """Create all required directories on startup."""
        for d in [FileStore.data_dir(), FileStore.documents_dir(), FileStore.previews_dir()]:
            os.makedirs(d, exist_ok=True)
        log.info("File store directories ensured at: %s", FileStore.data_dir())

    @staticmethod
    def document_dir(document_id: str) -> str:
        return os.path.join(FileStore.documents_dir(), document_id)

    @staticmethod
    def preview_dir(document_id: str) -> str:
        return os.path.join(FileStore.previews_dir(), document_id)

    @staticmethod
    def _validate_safe_path(path: str, base_dir: str):
        """Prevent path traversal attacks."""
        abs_base = os.path.abspath(base_dir)
        abs_path = os.path.abspath(path)
        if not abs_path.startswith(abs_base + os.sep) and abs_path != abs_base:
            raise ValueError(f"Path traversal detected: {path!r} is outside {base_dir!r}")

    @staticmethod
    def store_document(document_id: str, source_path: str, extension: str) -> str:
        """
        Copy a document into managed storage.

        Returns the absolute path to the stored file.
        Does NOT modify or delete the source file.
        """
        doc_dir = FileStore.document_dir(document_id)
        os.makedirs(doc_dir, exist_ok=True)

        # Clean the extension
        ext = extension.lstrip(".").lower()
        dest_path = os.path.join(doc_dir, f"original.{ext}")

        FileStore._validate_safe_path(dest_path, FileStore.documents_dir())

        shutil.copy2(source_path, dest_path)
        log.info("Stored document %s -> %s", document_id, dest_path)
        return dest_path

    @staticmethod
    def store_preview(document_id: str, image_bytes: bytes, page: int = 0) -> str:
        """
        Store a preview image for a document page.

        Returns the absolute path to the stored preview image.
        """
        preview_dir = FileStore.preview_dir(document_id)
        os.makedirs(preview_dir, exist_ok=True)

        preview_path = os.path.join(preview_dir, f"page_{page}.jpg")
        FileStore._validate_safe_path(preview_path, FileStore.previews_dir())

        with open(preview_path, "wb") as f:
            f.write(image_bytes)

        return preview_path

    @staticmethod
    def delete_document(document_id: str):
        """Delete all files associated with a document."""
        for d in [FileStore.document_dir(document_id), FileStore.preview_dir(document_id)]:
            if os.path.exists(d):
                shutil.rmtree(d)
                log.info("Deleted directory: %s", d)

    @staticmethod
    def get_document_path(document_id: str) -> str | None:
        """Return the path to the original stored document, or None if not found."""
        doc_dir = FileStore.document_dir(document_id)
        if not os.path.isdir(doc_dir):
            return None
        for f in os.listdir(doc_dir):
            if f.startswith("original."):
                return os.path.join(doc_dir, f)
        return None
