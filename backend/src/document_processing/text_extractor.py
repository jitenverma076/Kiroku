"""
Text extraction from documents.

Extraction strategy:
1. For PDFs: attempt pdfplumber to extract native text layer
2. If native text is sparse (< 50 chars), fall back to Tesseract OCR
3. For image files (JPEG, PNG, etc.): always use Tesseract OCR

Tesseract must be installed separately. If unavailable, extraction still
works for text-based PDFs but returns empty text for scanned images.

No remote services are used. All processing is local.
"""

from __future__ import annotations

import io
import logging
import os
from typing import Optional

log = logging.getLogger("kiroku.extractor")

# Optional imports — graceful degradation if not installed
try:
    import pdfplumber
    PDFPLUMBER_AVAILABLE = True
except ImportError:
    PDFPLUMBER_AVAILABLE = False
    log.warning("pdfplumber not installed. PDF text extraction unavailable.")

try:
    import pytesseract
    from PIL import Image
    TESSERACT_AVAILABLE = True
    # Verify tesseract binary is actually available
    try:
        pytesseract.get_tesseract_version()
    except Exception:
        TESSERACT_AVAILABLE = False
        log.warning("Tesseract binary not found. OCR unavailable for scanned documents.")
except ImportError:
    TESSERACT_AVAILABLE = False
    log.warning("pytesseract not installed. OCR unavailable.")

try:
    from pdf2image import convert_from_path
    PDF2IMAGE_AVAILABLE = True
except ImportError:
    PDF2IMAGE_AVAILABLE = False
    log.warning("pdf2image not installed. PDF preview generation unavailable.")


SUPPORTED_IMAGE_TYPES = {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".webp", ".bmp"}
SUPPORTED_PDF_TYPE = ".pdf"

# Minimum character count to consider native PDF text "useful"
MIN_NATIVE_TEXT_LENGTH = 50


def extract_text(file_path: str, mime_type: str) -> tuple[str, str]:
    """
    Extract text from a document file.

    Returns:
        (text, method) where method is one of: "native_pdf", "ocr", "none"
    """
    ext = os.path.splitext(file_path)[1].lower()

    if ext == SUPPORTED_PDF_TYPE:
        return _extract_pdf_text(file_path)
    elif ext in SUPPORTED_IMAGE_TYPES:
        return _extract_image_text(file_path)
    else:
        log.warning("Unsupported file type for extraction: %s", ext)
        return "", "none"


def _extract_pdf_text(file_path: str) -> tuple[str, str]:
    """Extract text from PDF — native first, OCR fallback."""
    native_text = ""

    if PDFPLUMBER_AVAILABLE:
        try:
            with pdfplumber.open(file_path) as pdf:
                pages_text = []
                for page in pdf.pages:
                    page_text = page.extract_text() or ""
                    pages_text.append(page_text)
                native_text = "\n\n".join(pages_text).strip()
        except Exception as e:
            log.warning("pdfplumber failed for %s: %s", file_path, e)

    if len(native_text) >= MIN_NATIVE_TEXT_LENGTH:
        log.debug("PDF native text extracted: %d chars", len(native_text))
        return native_text, "native_pdf"

    # Fall back to OCR
    if TESSERACT_AVAILABLE and PDF2IMAGE_AVAILABLE:
        log.info("Sparse native text (%d chars), falling back to OCR for %s",
                 len(native_text), file_path)
        return _pdf_ocr(file_path)

    # Return whatever we have
    return native_text, "native_pdf" if native_text else "none"


def _pdf_ocr(file_path: str) -> tuple[str, str]:
    """Convert PDF pages to images, then OCR each page."""
    try:
        images = convert_from_path(file_path, dpi=200, first_page=1, last_page=3)
        pages_text = []
        for img in images:
            text = pytesseract.image_to_string(img, config="--psm 3")
            pages_text.append(text)
        combined = "\n\n".join(pages_text).strip()
        log.debug("PDF OCR extracted: %d chars from %d pages", len(combined), len(images))
        return combined, "ocr"
    except Exception as e:
        log.error("PDF OCR failed for %s: %s", file_path, e)
        return "", "none"


def _extract_image_text(file_path: str) -> tuple[str, str]:
    """Extract text from image file using Tesseract OCR."""
    if not TESSERACT_AVAILABLE:
        log.warning("Tesseract unavailable; cannot extract text from image: %s", file_path)
        return "", "none"

    try:
        img = Image.open(file_path)
        # Convert to RGB if needed (handles RGBA, palette modes)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        text = pytesseract.image_to_string(img, config="--psm 3")
        text = text.strip()
        log.debug("Image OCR extracted: %d chars from %s", len(text), file_path)
        return text, "ocr"
    except Exception as e:
        log.error("Image OCR failed for %s: %s", file_path, e)
        return "", "none"


def generate_pdf_preview(file_path: str) -> Optional[bytes]:
    """
    Generate a JPEG preview image from the first page of a PDF.

    Returns JPEG bytes or None if generation fails.
    """
    if not PDF2IMAGE_AVAILABLE:
        return None
    try:
        images = convert_from_path(file_path, dpi=150, first_page=1, last_page=1)
        if not images:
            return None
        img = images[0]
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=75)
        return buf.getvalue()
    except Exception as e:
        log.warning("PDF preview generation failed: %s", e)
        return None


def generate_image_preview(file_path: str) -> Optional[bytes]:
    """
    Generate a resized JPEG preview of an image document.

    Returns JPEG bytes or None if generation fails.
    """
    if not TESSERACT_AVAILABLE:  # PIL is included with pytesseract dep
        return None
    try:
        img = Image.open(file_path)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        img.thumbnail((800, 1200), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=75)
        return buf.getvalue()
    except Exception as e:
        log.warning("Image preview generation failed: %s", e)
        return None


def get_capabilities() -> dict:
    """Return the current OCR/extraction capabilities for settings display."""
    return {
        "pdfplumber": PDFPLUMBER_AVAILABLE,
        "tesseract_ocr": TESSERACT_AVAILABLE,
        "pdf_preview": PDF2IMAGE_AVAILABLE,
    }
