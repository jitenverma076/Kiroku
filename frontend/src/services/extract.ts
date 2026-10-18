/**
 * Field extraction, ported from backend/src/ai/extractor.py.
 *
 * Runs in the browser so documents are never uploaded. Keep this in step with the
 * Python version — both must produce the same values for the same text.
 *
 * Never invents a value: a field that cannot be read stays null and the document
 * is flagged for review instead.
 */

export interface Field {
  value: string | null;
  confidence: number;
}

export interface Extraction {
  docType: string;
  vendor: Field;
  docNumber: Field;
  issueDate: Field;
  dueDate: Field;
  currency: Field;
  subtotal: Field;
  taxAmount: Field;
  totalAmount: Field;
  paymentTerms: Field;
  overallConfidence: number;
  needsReview: boolean;
}

const REVIEW_CONFIDENCE_THRESHOLD = 0.6;

const CURRENCY_CODES =
  'USD|EUR|GBP|JPY|INR|AUD|CAD|CHF|SEK|NOK|DKK|NZD|SGD|HKD|MXN|BRL|ZAR';

const CURRENCY_SYMBOLS: Array<[string, string]> = [
  ['A$', 'AUD'], ['C$', 'CAD'], ['$', 'USD'], ['€', 'EUR'],
  ['£', 'GBP'], ['¥', 'JPY'], ['₹', 'INR'],
];

// What may sit between a label and its number: a rate ("Tax (8.5%)" or a bare
// "8.5%"), a bracketed aside, a separator, and a currency symbol or ISO code.
const AMOUNT_GAP =
  String.raw`(?:\s*\(?\s*\d[\d.,]*\s*%\s*\)?)?` +
  String.raw`(?:\s*\([^)]*\))?` +
  String.raw`[\s:.]*` +
  String.raw`(?:[$€£¥₹]|\b(?:${CURRENCY_CODES})\b)?` +
  String.raw`\s*`;

const TOTAL_LABELS = [
  String.raw`(?:grand\s+)?total(?:\s+amount)?(?:\s+due)?`,
  String.raw`amount\s+due`,
  String.raw`total\s+payable`,
];
const SUBTOTAL_LABELS = [
  String.raw`subtotal`, String.raw`sub-total`, String.raw`sub\s+total`, String.raw`net\s+amount`,
];
const TAX_LABELS = [
  String.raw`(?:vat|gst|hst|pst|sales\s+)?tax(?:\s+amount)?`, String.raw`vat`, String.raw`gst`,
];

export function parseAmount(s: string): number | null {
  const cleaned = s.replace(/,/g, '').replace(/[^\d.]/g, '');
  if (!cleaned) return null;
  const v = Number.parseFloat(cleaned);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

/**
 * Find the amount belonging to a label.
 *
 * Word boundaries matter: without them "total" matches inside "Subtotal" and the
 * subtotal is silently booked as the total. The last match wins because an
 * invoice's summary block sits below the line items that reuse these words.
 */
export function labelledAmount(text: string, labels: string[]): Field {
  for (const label of labels) {
    const re = new RegExp(
      String.raw`\b${label}\b${AMOUNT_GAP}([0-9,]+(?:\.[0-9]{1,2})?)`,
      'gim',
    );
    const matches = [...text.matchAll(re)];
    if (matches.length) {
      const amount = parseAmount(matches[matches.length - 1][1]);
      if (amount !== null) return { value: String(amount), confidence: 0.85 };
    }
  }
  return { value: null, confidence: 0 };
}

// Labels stack up in the wild: "Invoice Number: INV-1", "Receipt No. 42".
const DOC_LABEL =
  String.raw`(?:\b(?:invoice|receipt|bill|order|reference|ref|document|doc|transaction|txn|no|number)\b\.?|#)`;
const DOC_NUMBER_RE = new RegExp(
  String.raw`${DOC_LABEL}(?:[:\s#]*${DOC_LABEL})*[:\s#]*([A-Z0-9][A-Z0-9\-/]*)`,
  'gim',
);

/** A label often precedes another label, so candidates without a digit are skipped. */
export function extractDocNumber(text: string): Field {
  for (const m of text.matchAll(DOC_NUMBER_RE)) {
    const num = m[1].trim();
    if (num.length >= 2 && num.length <= 50 && /\d/.test(num)) {
      return { value: num, confidence: 0.75 };
    }
  }
  return { value: null, confidence: 0 };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const DATE_VALUE_RE = new RegExp(
  String.raw`(\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2})` +
  String.raw`|(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})` +
  String.raw`|((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s*\d{4})`,
  'i',
);

const iso = (y: number, m: number, d: number): string | null => {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** Parse the shapes DATE_VALUE_RE matches into ISO 8601. Month-first, like the backend. */
export function parseDateString(s: string): string | null {
  const t = s.trim();

  let m = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(t);
  if (m) return iso(+m[1], +m[2], +m[3]);

  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(t);
  if (m) {
    let year = +m[3];
    if (year < 100) year += year < 70 ? 2000 : 1900;
    return iso(year, +m[1], +m[2]);
  }

  m = /^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s*(\d{4})$/.exec(t);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    return month ? iso(+m[3], month, +m[2]) : null;
  }
  return null;
}

const DATE_LABELS = [String.raw`(?:invoice|document|issue|doc)\s*(?:date|dt)`, String.raw`date`];
const DUE_LABELS = [String.raw`(?:due|payment|pay\s*by|payable\s*by)\s*(?:date|dt|on|by)?`];

export function extractDate(text: string, labels: string[]): Field {
  for (const label of labels) {
    const re = new RegExp(String.raw`${label}\s*[:\-]?\s*([\s\S]{0,60})`, 'im');
    const m = re.exec(text);
    if (m) {
      const dm = DATE_VALUE_RE.exec(m[1]);
      const parsed = dm && parseDateString(dm.find((g, i) => i > 0 && g) as string);
      if (parsed) return { value: parsed, confidence: 0.8 };
    }
  }
  const dm = DATE_VALUE_RE.exec(text);
  const parsed = dm && parseDateString(dm.find((g, i) => i > 0 && g) as string);
  return parsed ? { value: parsed, confidence: 0.35 } : { value: null, confidence: 0 };
}

const VENDOR_LABEL_RE =
  /(?:from|vendor|supplier|seller|billed?\s+by|issued?\s+by|company)[:\s]+(.+)/im;

export function extractVendor(text: string): Field {
  const m = VENDOR_LABEL_RE.exec(text);
  if (m) {
    const vendor = m[1].split('\n')[0].trim();
    if (vendor.length >= 3 && vendor.length <= 100) return { value: vendor, confidence: 0.8 };
  }
  // Documents usually lead with the company name.
  for (const line of text.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 5)) {
    if (/^[\d\s\W]+$/.test(line)) continue;
    if (line.length < 3 || line.length > 100) continue;
    if (/^(invoice|receipt|bill|tax invoice|credit note|statement)\s*$/i.test(line)) continue;
    return { value: line, confidence: 0.45 };
  }
  return { value: null, confidence: 0 };
}

export function extractCurrency(text: string): Field {
  const m = new RegExp(String.raw`\b(${CURRENCY_CODES})\b`, 'i').exec(text);
  if (m) return { value: m[1].toUpperCase(), confidence: 0.9 };
  for (const [symbol, code] of CURRENCY_SYMBOLS) {
    if (text.includes(symbol)) return { value: code, confidence: 0.7 };
  }
  return { value: null, confidence: 0 };
}

const TERMS_RE =
  /(?:payment\s+terms?|terms?)[:\s]*(net\s+\d+\s+days?|net\s+\d+|due\s+on\s+receipt|immediate|prepaid)/i;

export function extractTerms(text: string): Field {
  const m = TERMS_RE.exec(text);
  return m ? { value: m[1].trim(), confidence: 0.75 } : { value: null, confidence: 0 };
}

const INVOICE_WORDS = ['invoice', 'bill to', 'payment terms', 'due date', 'amount due', 'remit'];
const RECEIPT_WORDS = ['receipt', 'thank you', 'cash', 'card', 'change due', 'tendered', 'paid'];
const BILL_WORDS = ['statement', 'utility', 'account number', 'service period', 'meter'];
const CREDIT_WORDS = ['credit note', 'credit memo', 'refund', 'adjustment'];

const hits = (text: string, words: string[]) => words.filter(w => text.includes(w)).length;

/** Keyword and structure classification, mirroring the backend's rule-based path. */
export function classify(text: string): { docType: string; confidence: number } {
  const lower = text.toLowerCase();
  const scores: Record<string, number> = {
    invoice: Math.min(0.6, (hits(lower, INVOICE_WORDS) / INVOICE_WORDS.length) * 3),
    receipt: Math.min(0.6, (hits(lower, RECEIPT_WORDS) / RECEIPT_WORDS.length) * 3),
    bill: Math.min(0.6, (hits(lower, BILL_WORDS) / BILL_WORDS.length) * 3),
    credit_note: Math.min(0.9, (hits(lower, CREDIT_WORDS) / CREDIT_WORDS.length) * 5),
  };
  if (lower.includes('credit') && (lower.includes('note') || lower.includes('memo'))) {
    scores.credit_note += 0.3;
  }
  if (lower.includes('total') && hits(lower, RECEIPT_WORDS) >= 2) scores.receipt += 0.15;

  const best = Object.keys(scores).reduce((a, b) => (scores[a] >= scores[b] ? a : b));
  if (scores[best] < 0.1) return { docType: 'unknown', confidence: 0 };
  return { docType: best, confidence: Math.min(0.95, Number(scores[best].toFixed(3))) };
}

export function extractFields(text: string): Extraction {
  const empty = (): Field => ({ value: null, confidence: 0 });
  if (!text.trim()) {
    return {
      docType: 'unknown',
      vendor: empty(), docNumber: empty(), issueDate: empty(), dueDate: empty(),
      currency: empty(), subtotal: empty(), taxAmount: empty(), totalAmount: empty(),
      paymentTerms: empty(),
      overallConfidence: 0, needsReview: true,
    };
  }

  const { docType } = classify(text);
  const vendor = extractVendor(text);
  const docNumber = extractDocNumber(text);
  const issueDate = extractDate(text, DATE_LABELS);
  const dueDate = extractDate(text, DUE_LABELS);
  const currency = extractCurrency(text);
  const total = labelledAmount(text, TOTAL_LABELS);
  const subtotal = labelledAmount(text, SUBTOTAL_LABELS);
  const tax = labelledAmount(text, TAX_LABELS);
  const paymentTerms = extractTerms(text);

  // Agreement between the three money fields is evidence they were read correctly.
  if (subtotal.value && tax.value && total.value) {
    const computed = Number(subtotal.value) + Number(tax.value);
    const totalNum = Number(total.value);
    if (Math.abs(computed - totalNum) / Math.max(totalNum, 0.01) < 0.01) {
      total.confidence = Math.min(0.95, total.confidence + 0.1);
      subtotal.confidence = Math.min(0.95, subtotal.confidence + 0.1);
      tax.confidence = Math.min(0.95, tax.confidence + 0.1);
    }
  }

  const key = [vendor, docNumber, issueDate, currency, total]
    .map(f => f.confidence)
    .filter(c => c > 0);
  const overall = key.length ? Number((key.reduce((a, b) => a + b, 0) / key.length).toFixed(3)) : 0;

  return {
    docType,
    vendor, docNumber, issueDate, dueDate, currency,
    subtotal, taxAmount: tax, totalAmount: total, paymentTerms,
    overallConfidence: overall,
    needsReview: key.some(c => c < REVIEW_CONFIDENCE_THRESHOLD) || overall < REVIEW_CONFIDENCE_THRESHOLD,
  };
}

/** Parity checks against the Python extractor. Run with scripts/check-extract.sh. */
export function selfCheck(): void {
  const assert = (cond: unknown, msg: string) => {
    if (!cond) throw new Error(`FAILED: ${msg}`);
  };

  const INVOICE = [
    'ACME STUDIO',
    'Invoice INV-2026-0188',
    'Design sprint        4,800.00',
    'Subtotal: $5,750.00',
    'Tax (8.5%): $488.75',
    'Total: $6,238.75',
  ].join('\n');

  assert(labelledAmount(INVOICE, SUBTOTAL_LABELS).value === '5750', 'subtotal');
  assert(labelledAmount(INVOICE, TAX_LABELS).value === '488.75', 'tax');
  // "total" must not match inside "Subtotal", or the subtotal is booked as the total.
  assert(labelledAmount(INVOICE, TOTAL_LABELS).value === '6238.75', 'total not subtotal');

  // A currency code may sit between the label and the number.
  assert(labelledAmount('Total: USD 250.50', TOTAL_LABELS).value === '250.5', 'currency code');
  assert(labelledAmount('Grand Total EUR 1,004.20', TOTAL_LABELS).value === '1004.2', 'grand total');
  // A rate must not be read as the amount, bracketed or not.
  assert(labelledAmount('Tax 8.5%: USD 488.75', TAX_LABELS).value === '488.75', 'bare rate');
  assert(labelledAmount('Tax (8.5%) 488.75', TAX_LABELS).value === '488.75', 'bracketed rate');
  assert(labelledAmount('Tax: 8.50', TAX_LABELS).value === '8.5', 'no rate present');
  // The summary block below the line items wins.
  assert(labelledAmount('Total\n12.00\nTotal: 99.00', TOTAL_LABELS).value === '99', 'last match');
  assert(labelledAmount('no amounts here', TOTAL_LABELS).value === null, 'absent');

  assert(extractDocNumber('Invoice Number: INV-2026-0188').value === 'INV-2026-0188', 'stacked labels');
  assert(extractDocNumber('RECEIPT\nReceipt No: RCP-7741').value === 'RCP-7741', 'receipt no');
  // "no" must not match inside a vendor name, nor "note".
  assert(extractDocNumber('NORTHWIND STUDIO LLC\nReference: CN-0092').value === 'CN-0092', 'not NORTHWIND');
  assert(extractDocNumber('CREDIT NOTE\nReference: CN-0092').value === 'CN-0092', 'not NOTE');
  assert(extractDocNumber('ACME STUDIO LLC').value === null, 'no digits');

  assert(parseDateString('2026-09-14') === '2026-09-14', 'iso date');
  assert(parseDateString('09/14/2026') === '2026-09-14', 'month-first');
  assert(parseDateString('Sep 14, 2026') === '2026-09-14', 'month name');
  assert(parseDateString('14/09/1800') === null, 'year out of range');

  assert(extractCurrency('Total: USD 10').value === 'USD', 'currency code');
  assert(extractCurrency('Total: $10').value === 'USD', 'currency symbol');

  const full = extractFields(INVOICE);
  assert(full.totalAmount.value === '6238.75', 'end-to-end total');
  assert(full.vendor.value === 'ACME STUDIO', 'end-to-end vendor');
  assert(full.docNumber.value === 'INV-2026-0188', 'end-to-end doc number');

  console.log('extract.ts parity: ok');
}
