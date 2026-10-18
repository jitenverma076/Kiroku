"""
Document classifier — local rule-based implementation.

Classifies documents into: invoice, receipt, bill, credit_note, unknown

Architecture:
- Uses keyword matching and structural analysis of extracted text
- Each signal contributes to a scored confidence model
- No remote APIs. No ML model weights required.
- The classifier interface is designed to be replaceable with an ML classifier.

Classification confidence signals:
  INVOICE keywords:   invoice, tax invoice, pro forma, bill to, ship to, payment due
  RECEIPT keywords:   receipt, cash receipt, payment received, thank you for your purchase
  BILL keywords:      bill, statement, amount due, please pay, due by
  CREDIT_NOTE:        credit note, credit memo, refund, adjustment
"""

from __future__ import annotations

import logging
import re
from typing import Tuple

log = logging.getLogger("kiroku.classifier")

# Keyword sets by document type (all lowercase)
INVOICE_KEYWORDS = [
    "invoice", "tax invoice", "pro forma", "proforma",
    "bill to", "ship to", "payment due", "invoice number",
    "invoice no", "invoice date", "due date", "remittance",
    "purchase order", "po number",
]

RECEIPT_KEYWORDS = [
    "receipt", "cash receipt", "payment received", "amount paid",
    "thank you for your purchase", "thank you for shopping",
    "transaction id", "receipt number", "receipt no",
    "paid in full", "change due", "subtotal",
]

BILL_KEYWORDS = [
    "bill", "statement", "amount due", "please pay",
    "due by", "account summary", "billing period",
    "your bill", "monthly statement", "account statement",
]

CREDIT_NOTE_KEYWORDS = [
    "credit note", "credit memo", "refund",
    "credit adjustment", "returned goods", "credit invoice",
    "amount credited",
]


def _count_keyword_hits(text_lower: str, keywords: list[str]) -> int:
    """Count how many keywords appear in the text."""
    count = 0
    for kw in keywords:
        if kw in text_lower:
            count += 1
    return count


def _has_invoice_structure(text: str) -> bool:
    """Check for tabular line-item structure typical of invoices."""
    # Look for patterns like: item description | qty | price | total
    qty_price = re.search(r'\b(qty|quantity|units?|hours?)\b', text, re.I)
    unit_price = re.search(r'\b(unit price|rate|price each|@)\b', text, re.I)
    line_total = re.search(r'\b(line total|amount|ext\.?|extended)\b', text, re.I)
    return bool(qty_price) and bool(unit_price or line_total)


def classify_document(text: str) -> Tuple[str, float]:
    """
    Classify a document given its extracted text.

    Returns:
        (doc_type, confidence) where doc_type is one of:
        invoice | receipt | bill | credit_note | unknown
    """
    if not text or len(text.strip()) < 10:
        return "unknown", 0.0

    text_lower = text.lower()

    scores: dict[str, float] = {
        "invoice": 0.0,
        "receipt": 0.0,
        "bill": 0.0,
        "credit_note": 0.0,
    }

    # Count keyword hits for each type
    invoice_hits  = _count_keyword_hits(text_lower, INVOICE_KEYWORDS)
    receipt_hits  = _count_keyword_hits(text_lower, RECEIPT_KEYWORDS)
    bill_hits     = _count_keyword_hits(text_lower, BILL_KEYWORDS)
    credit_hits   = _count_keyword_hits(text_lower, CREDIT_NOTE_KEYWORDS)

    # Base score: keyword density (capped at 0.6)
    total_keywords_available = len(INVOICE_KEYWORDS)
    scores["invoice"]     = min(0.60, invoice_hits / max(1, total_keywords_available) * 3.0)
    scores["receipt"]     = min(0.60, receipt_hits / max(1, len(RECEIPT_KEYWORDS)) * 3.0)
    scores["bill"]        = min(0.60, bill_hits / max(1, len(BILL_KEYWORDS)) * 3.0)
    scores["credit_note"] = min(0.90, credit_hits / max(1, len(CREDIT_NOTE_KEYWORDS)) * 5.0)

    # Structural bonuses
    if _has_invoice_structure(text):
        scores["invoice"] += 0.2

    # Disambiguation: credit_note highly specific — boost it
    if "credit" in text_lower and ("note" in text_lower or "memo" in text_lower):
        scores["credit_note"] += 0.3

    # Receipt usually has "total" and a small number of items
    if "total" in text_lower and receipt_hits >= 2:
        scores["receipt"] += 0.15

    # Let the optional classifier raise the score of the type it favours.
    try:
        from ai.model_engine import get_ai_engine
        prediction = get_ai_engine().classify(text)
        if prediction:
            ml_type, ml_conf = prediction
            scores[ml_type] = max(scores.get(ml_type, 0.0), ml_conf)
            log.debug("Classifier predicted '%s' (%.2f)", ml_type, ml_conf)
    except Exception as e:
        log.debug("Classifier skipped: %s", e)

    # Pick highest score
    best_type = max(scores, key=lambda k: scores[k])
    best_score = scores[best_type]

    # Require a minimum confidence threshold
    if best_score < 0.1:
        return "unknown", 0.0

    # Cap at 0.95 — never claim perfect confidence
    confidence = min(0.95, best_score)
    log.debug("Classification scores: %s -> %s (%.2f)", scores, best_type, confidence)

    return best_type, round(confidence, 3)
