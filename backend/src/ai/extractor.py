"""
Structured field extractor — local regex + pattern-matching implementation.

Extracts:
  vendor, doc_number, issue_date, due_date, currency,
  subtotal, tax_amount, total_amount, payment_terms

Design principles:
- Never fabricate missing fields (return None when not found)
- Confidence based on pattern specificity and signal agreement
- All processing is local — no remote API calls
- Designed to be replaceable with an ML extractor if desired
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Optional, Tuple

from dateutil import parser as dateutil_parser

from domain.models import ExtractionResult, FieldExtraction

log = logging.getLogger("kiroku.extractor")

# ── Currency patterns ─────────────────────────────────────────────────────────
CURRENCY_SYMBOLS = {
    "$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR",
    "A$": "AUD", "C$": "CAD", "CHF": "CHF", "kr": "SEK",
}

CURRENCY_CODE_RE = re.compile(
    r'\b(USD|EUR|GBP|JPY|INR|AUD|CAD|CHF|SEK|NOK|DKK|NZD|SGD|HKD|MXN|BRL|ZAR)\b',
    re.I
)

# ── Amount patterns ───────────────────────────────────────────────────────────
# Matches: $1,234.56 | 1234.56 | 1,234 | £99.99
AMOUNT_RE = re.compile(
    r'[\$€£¥₹]?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)'
)

def _parse_amount(s: str) -> Optional[float]:
    """Parse an amount string, removing commas, symbols."""
    if not s:
        return None
    s = re.sub(r'[^\d.]', '', s.replace(',', ''))
    try:
        v = float(s)
        return v if v >= 0 else None
    except ValueError:
        return None

# ── Date patterns ─────────────────────────────────────────────────────────────
DATE_LABELS = [
    r'(?:invoice|document|issue|doc)\s*(?:date|dt)',
    r'date',
]

DUE_LABELS = [
    r'(?:due|payment|pay\s*by|payable\s*by)\s*(?:date|dt|on|by)?',
]

DATE_VALUE_RE = re.compile(
    r'\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})'
    r'|(\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})'
    r'|(\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?'
    r'|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)'
    r'\s+\d{1,2},?\s*\d{4})',
    re.I
)

def _extract_date(text: str, label_patterns: list[str]) -> Tuple[Optional[str], float]:
    """
    Find the first date value that follows a matching label.
    Returns (iso_date_string, confidence).
    """
    for label in label_patterns:
        pattern = re.compile(
            r'(?i)' + label + r'\s*[:\-]?\s*(.{0,60})',
            re.MULTILINE
        )
        m = pattern.search(text)
        if m:
            candidate_text = m.group(1)
            dm = DATE_VALUE_RE.search(candidate_text)
            if dm:
                date_str = next(g for g in dm.groups() if g)
                parsed = _parse_date_string(date_str)
                if parsed:
                    return parsed, 0.80
    # No label found — try to find any date
    dm = DATE_VALUE_RE.search(text)
    if dm:
        date_str = next(g for g in dm.groups() if g)
        parsed = _parse_date_string(date_str)
        if parsed:
            return parsed, 0.35
    return None, 0.0

def _parse_date_string(s: str) -> Optional[str]:
    """Parse a date string and return ISO 8601 format, or None."""
    try:
        dt = dateutil_parser.parse(s, dayfirst=False)
        # Sanity check: reject dates far in the future or unreasonably old
        if dt.year < 1990 or dt.year > 2100:
            return None
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return None

# ── Vendor extraction ─────────────────────────────────────────────────────────
VENDOR_LABEL_RE = re.compile(
    r'(?i)(?:from|vendor|supplier|seller|billed?\s+by|issued?\s+by|company)[:\s]+(.+)',
    re.MULTILINE
)

def _extract_vendor(text: str) -> Tuple[Optional[str], float]:
    """
    Extract vendor/company name from document text.

    Strategy:
    1. Look for explicit "From:", "Vendor:", "Billed by:" labels
    2. Look for company name in first 5 lines (heuristic: documents usually start with company name)
    """
    # 1. Labelled approach
    m = VENDOR_LABEL_RE.search(text)
    if m:
        vendor = m.group(1).strip().split('\n')[0].strip()
        if 3 <= len(vendor) <= 100:
            return vendor, 0.80

    # 2. First non-empty, non-numeric line (heuristic)
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    for line in lines[:5]:
        # Skip lines that look like dates, numbers, or short codes
        if re.match(r'^[\d\s\W]+$', line):
            continue
        if len(line) < 3 or len(line) > 100:
            continue
        # Skip lines that are clearly header-like keywords
        if re.match(r'^(invoice|receipt|bill|tax invoice|credit note|statement)\s*$', line, re.I):
            continue
        return line, 0.45

    return None, 0.0

# ── Document number extraction ────────────────────────────────────────────────
# The labels need word boundaries: without them "no" matches inside "NORTHWIND"
# and the vendor's own name is captured as the document number.
_DOC_NUMBER_LABEL = (
    r'(?:\b(?:invoice|receipt|bill|order|reference|ref|document|doc|transaction|txn|no|number)\b\.?|#)'
)
DOC_NUMBER_RE = re.compile(
    # Labels stack up in the wild: "Invoice Number: INV-1", "Receipt No. 42".
    r'(?i)' + _DOC_NUMBER_LABEL + r'(?:[:\s#]*' + _DOC_NUMBER_LABEL + r')*'
    r'[:\s#]*([A-Z0-9][A-Z0-9\-/]*)',
    re.MULTILINE,
)


def _extract_doc_number(text: str) -> Tuple[Optional[str], float]:
    """Return the first candidate that looks like a reference.

    A label often precedes another label ("Invoice Number: INV-1"), so candidates
    without a digit are skipped rather than returned as the answer.
    """
    for m in DOC_NUMBER_RE.finditer(text):
        num = m.group(1).strip()
        if 2 <= len(num) <= 50 and any(c.isdigit() for c in num):
            return num, 0.75
    return None, 0.0

# ── Amount extraction ─────────────────────────────────────────────────────────
# What may sit between a label and its number: a rate in brackets ("Tax (8.5%)"),
# a separator, and a currency symbol or ISO code ("Total: USD 1,234.00").
_AMOUNT_GAP = (
    r'(?:\s*\(?\s*\d[\d.,]*\s*%\s*\)?)?'   # a rate: "(8.5%)" or a bare "8.5%"
    r'(?:\s*\([^)]*\))?'                      # any other bracketed aside
    r'[\s:.]*'
    r'(?:[\$€£¥₹]|\b(?:USD|EUR|GBP|JPY|INR|AUD|CAD|CHF|SEK|NOK|DKK|NZD|SGD|HKD|MXN|BRL|ZAR)\b)?'
    r'\s*'
)


def _extract_labelled_amount(text: str, labels: list[str]) -> Tuple[Optional[float], float]:
    """Find the amount belonging to a label.

    Word boundaries matter here: without them "total" matches inside "Subtotal"
    and the subtotal is silently booked as the total. The last match wins because
    an invoice's summary block sits below the line items that reuse these words.
    """
    for label in labels:
        pattern = re.compile(
            r'(?i)\b' + label + r'\b' + _AMOUNT_GAP + r'([0-9,]+(?:\.[0-9]{1,2})?)',
            re.MULTILINE,
        )
        matches = pattern.findall(text)
        if matches:
            amount = _parse_amount(matches[-1])
            if amount is not None and amount >= 0:
                return amount, 0.85
    return None, 0.0

TOTAL_LABELS    = [r'(?:grand\s+)?total(?:\s+amount)?(?:\s+due)?', r'amount\s+due', r'total\s+payable']
SUBTOTAL_LABELS = [r'subtotal', r'sub-total', r'sub\s+total', r'net\s+amount']
TAX_LABELS      = [r'(?:vat|gst|hst|pst|sales\s+)?tax(?:\s+amount)?', r'vat', r'gst']

# ── Currency extraction ───────────────────────────────────────────────────────
def _extract_currency(text: str) -> Tuple[Optional[str], float]:
    # Try explicit currency code first
    m = CURRENCY_CODE_RE.search(text)
    if m:
        return m.group(1).upper(), 0.90

    # Try symbol
    for symbol, code in CURRENCY_SYMBOLS.items():
        if symbol in text:
            return code, 0.70

    return None, 0.0

# ── Payment terms extraction ──────────────────────────────────────────────────
PAYMENT_TERMS_RE = re.compile(
    r'(?i)(?:payment\s+terms?|terms?)[:\s]*(net\s+\d+|due\s+on\s+receipt|net\s+\d+\s+days?|immediate|prepaid)',
    re.MULTILINE
)

def _extract_payment_terms(text: str) -> Tuple[Optional[str], float]:
    m = PAYMENT_TERMS_RE.search(text)
    if m:
        return m.group(1).strip(), 0.80
    return None, 0.0

# ── Main extraction function ──────────────────────────────────────────────────
REVIEW_CONFIDENCE_THRESHOLD = 0.60

def extract_fields(text: str, doc_type: str) -> ExtractionResult:
    """
    Extract structured fields from document text.

    Returns ExtractionResult with per-field confidence scores.
    Fields with confidence below REVIEW_CONFIDENCE_THRESHOLD trigger review.
    """
    if not text:
        return ExtractionResult(
            doc_type=FieldExtraction(value=doc_type, confidence=0.0),
            vendor=FieldExtraction(), doc_number=FieldExtraction(),
            issue_date=FieldExtraction(), due_date=FieldExtraction(),
            currency=FieldExtraction(), subtotal=FieldExtraction(),
            tax_amount=FieldExtraction(), total_amount=FieldExtraction(),
            payment_terms=FieldExtraction(),
            overall_confidence=0.0, needs_review=True, raw_text="",
        )

    vendor_val, vendor_conf          = _extract_vendor(text)
    doc_num_val, doc_num_conf        = _extract_doc_number(text)
    issue_date_val, issue_date_conf  = _extract_date(text, DATE_LABELS)
    due_date_val, due_date_conf      = _extract_date(text, DUE_LABELS)
    currency_val, currency_conf      = _extract_currency(text)
    total_val, total_conf            = _extract_labelled_amount(text, TOTAL_LABELS)
    subtotal_val, subtotal_conf      = _extract_labelled_amount(text, SUBTOTAL_LABELS)
    tax_val, tax_conf                = _extract_labelled_amount(text, TAX_LABELS)
    terms_val, terms_conf            = _extract_payment_terms(text)

    # ── Financial consistency check ───────────────────────────────────────────
    # If subtotal + tax ≈ total (within 1%), boost confidence
    if subtotal_val is not None and tax_val is not None and total_val is not None:
        computed = round(subtotal_val + tax_val, 2)
        if abs(computed - total_val) / max(total_val, 0.01) < 0.01:
            total_conf    = min(0.95, total_conf + 0.10)
            subtotal_conf = min(0.95, subtotal_conf + 0.10)
            tax_conf      = min(0.95, tax_conf + 0.10)

    def make_field(value, confidence) -> FieldExtraction:
        return FieldExtraction(
            value=str(value) if value is not None else None,
            confidence=round(confidence, 3),
        )

    fields_and_confidences = [
        vendor_conf, doc_num_conf, issue_date_conf,
        currency_conf, total_conf,
    ]
    key_confidences = [c for c in fields_and_confidences if c > 0]
    overall = round(sum(key_confidences) / len(key_confidences), 3) if key_confidences else 0.0

    needs_review = any(c < REVIEW_CONFIDENCE_THRESHOLD for c in key_confidences if c > 0)
    needs_review = needs_review or overall < REVIEW_CONFIDENCE_THRESHOLD

    return ExtractionResult(
        doc_type=FieldExtraction(value=doc_type, confidence=0.80),
        vendor=make_field(vendor_val, vendor_conf),
        doc_number=make_field(doc_num_val, doc_num_conf),
        issue_date=make_field(issue_date_val, issue_date_conf),
        due_date=make_field(due_date_val, due_date_conf),
        currency=make_field(currency_val, currency_conf),
        subtotal=make_field(subtotal_val, subtotal_conf),
        tax_amount=make_field(tax_val, tax_conf),
        total_amount=make_field(total_val, total_conf),
        payment_terms=make_field(terms_val, terms_conf),
        overall_confidence=overall,
        needs_review=needs_review,
        raw_text=text[:50000],  # Cap stored raw text at 50K chars
    )


if __name__ == "__main__":  # python -m ai.extractor
    INVOICE = """ACME STUDIO
    Invoice INV-2026-0188
    Design sprint        4,800.00
    Motion guidelines      950.00
    Subtotal: $5,750.00
    Tax (8.5%): $488.75
    Total: $6,238.75
    """
    assert _extract_labelled_amount(INVOICE, SUBTOTAL_LABELS)[0] == 5750.00
    assert _extract_labelled_amount(INVOICE, TAX_LABELS)[0] == 488.75
    # A tax rate between the label and the amount must not be read as the amount,
    # with or without brackets around it.
    assert _extract_labelled_amount("Tax 8.5%: USD 488.75", TAX_LABELS)[0] == 488.75
    assert _extract_labelled_amount("Tax (8.5%) 488.75", TAX_LABELS)[0] == 488.75
    assert _extract_labelled_amount("Tax: 8.50", TAX_LABELS)[0] == 8.50
    # "total" must not match inside "Subtotal", or the subtotal is booked as the total.
    assert _extract_labelled_amount(INVOICE, TOTAL_LABELS)[0] == 6238.75

    # A currency code may sit between the label and the number.
    assert _extract_labelled_amount("Total: USD 250.50", TOTAL_LABELS)[0] == 250.50
    assert _extract_labelled_amount("Grand Total EUR 1,004.20", TOTAL_LABELS)[0] == 1004.20

    # Line-item columns above the summary must not win over the summary itself.
    assert _extract_labelled_amount("Total\n12.00\nTotal: 99.00", TOTAL_LABELS)[0] == 99.00

    assert _extract_labelled_amount("no amounts here", TOTAL_LABELS) == (None, 0.0)

    assert _extract_doc_number("Invoice Number: INV-2026-0188")[0] == "INV-2026-0188"
    assert _extract_doc_number("RECEIPT\nReceipt No: RCP-7741")[0] == "RCP-7741"
    # "no" must not match inside a vendor name, nor "note".
    assert _extract_doc_number("NORTHWIND STUDIO LLC\nReference: CN-0092")[0] == "CN-0092"
    assert _extract_doc_number("CREDIT NOTE\nReference: CN-0092")[0] == "CN-0092"
    assert _extract_doc_number("ACME STUDIO LLC") == (None, 0.0)
    print("extractor parsing: ok")
