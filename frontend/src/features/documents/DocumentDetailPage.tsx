import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle, RefreshCw, Trash2, Download,
  ExternalLink, AlertTriangle, Check, Tag as TagIcon, Plus, X,
} from 'lucide-react';
import {
  getDocument, updateDocument, deleteDocument, reprocessDocument,
  getPreviewUrl, getOriginalFileUrl, addTagToDocument, removeTagFromDocument, errorMessage,
} from '../../services/api';
import type { DocumentDetail, DocumentType } from '../../types';
import ConfirmModal from '../../components/ui/ConfirmModal';

const DOC_TYPES: Array<{ value: DocumentType; label: string }> = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'receipt', label: 'Receipt' },
  { value: 'bill', label: 'Bill' },
  { value: 'credit_note', label: 'Credit Note' },
  { value: 'unknown', label: 'Unknown' },
];

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [fileHref, setFileHref] = useState('');

  // Form state
  const [docType, setDocType] = useState<DocumentType>('invoice');
  const [vendor, setVendor] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [subtotal, setSubtotal] = useState('');
  const [taxAmount, setTaxAmount] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [newTagInput, setNewTagInput] = useState('');

  useEffect(() => {
    if (!id) return;
    loadData(id);
  }, [id]);

  const loadData = async (docId: string) => {
    setLoading(true);
    setError(null);
    try {
      const doc = await getDocument(docId);
      setDocument(doc);
      setFileHref(await getOriginalFileUrl(docId));
      setDocType(doc.doc_type || 'unknown');
      setVendor(doc.vendor || '');
      setDocNumber(doc.doc_number || '');
      setIssueDate(doc.issue_date || '');
      setDueDate(doc.due_date || '');
      setCurrency(doc.currency || 'USD');
      setSubtotal(doc.subtotal != null ? String(doc.subtotal) : '');
      setTaxAmount(doc.tax_amount != null ? String(doc.tax_amount) : '');
      setTotalAmount(doc.total_amount != null ? String(doc.total_amount) : '');
      setPaymentTerms(doc.payment_terms || '');
      setNotes(doc.notes || '');
    } catch (err) {
      setError(errorMessage(err, 'Failed to load document'));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (confirm = false) => {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateDocument(id, {
        doc_type: docType,
        vendor: vendor.trim() || undefined,
        doc_number: docNumber.trim() || undefined,
        issue_date: issueDate || undefined,
        due_date: dueDate || undefined,
        currency: currency.trim() || undefined,
        subtotal: subtotal !== '' ? parseFloat(subtotal) : undefined,
        tax_amount: taxAmount !== '' ? parseFloat(taxAmount) : undefined,
        total_amount: totalAmount !== '' ? parseFloat(totalAmount) : undefined,
        payment_terms: paymentTerms.trim() || undefined,
        notes: notes.trim() || undefined,
        user_confirmed: confirm ? true : document?.user_confirmed,
      });
      setDocument(updated);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(errorMessage(err, 'Failed to save changes'));
    } finally {
      setSaving(false);
    }
  };

  const handleReprocess = async () => {
    if (!id) return;
    setReprocessing(true);
    setError(null);
    try {
      await reprocessDocument(id);
      await loadData(id);
    } catch (err) {
      setError(errorMessage(err, 'Failed to reprocess document'));
    } finally {
      setReprocessing(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      await deleteDocument(id);
      navigate('/documents');
    } catch (err) {
      setError(errorMessage(err, 'Failed to delete document'));
      setDeleteModalOpen(false);
    }
  };

  // Math validation: subtotal + tax should reconcile with the total.
  const numSubtotal = parseFloat(subtotal) || 0;
  const numTax = parseFloat(taxAmount) || 0;
  const numTotal = parseFloat(totalAmount) || 0;
  const hasAllComponents = subtotal !== '' && taxAmount !== '' && totalAmount !== '';
  const mathMismatch = hasAllComponents && Math.abs(numSubtotal + numTax - numTotal) > 0.02;

  if (loading) {
    return (
      <div className="empty-state">
        <div className="spinner spinner-lg" role="status" aria-label="Loading" />
        <p>Loading document…</p>
      </div>
    );
  }

  if (error && !document) {
    return (
      <div className="empty-state">
        <AlertTriangle className="empty-state-icon text-danger" aria-hidden />
        <h3>Could not load this document</h3>
        <p>{error}</p>
        <button className="btn btn-secondary" onClick={() => navigate('/documents')}>
          Back to documents
        </button>
      </div>
    );
  }

  if (!document) return null;

  return (
    <div>
      <div className="page-head">
        <div>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/documents')}>
            <ArrowLeft size={14} aria-hidden /> Back to documents
          </button>
          <h1 className="truncate" style={{ maxWidth: '60ch' }}>{document.filename}</h1>
          <p className="mono">
            {document.mime_type} · {(document.file_size / 1024).toFixed(1)} KB
          </p>
        </div>

        <div className="page-head-actions">
          <span className={`badge ${document.user_confirmed ? 'badge-success' : 'badge-warning'}`}>
            {document.user_confirmed
              ? <><CheckCircle size={12} aria-hidden /> Confirmed</>
              : <><AlertTriangle size={12} aria-hidden /> Unverified</>}
          </span>

          <a
            href={fileHref}
            download={document.filename}
            className="btn btn-secondary btn-sm"
          >
            <Download size={14} aria-hidden /> Original
          </a>

          <button
            className="btn btn-secondary btn-sm"
            onClick={handleReprocess}
            disabled={reprocessing}
            title="Re-run local extraction"
          >
            <RefreshCw size={14} className={reprocessing ? 'spin' : ''} aria-hidden />
            {reprocessing ? 'Extracting…' : 'Re-extract'}
          </button>

          <button
            className="btn btn-danger btn-sm btn-icon"
            onClick={() => setDeleteModalOpen(true)}
            aria-label="Delete document"
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </div>
      </div>

      {error && <div className="alert alert-danger mb-4">{error}</div>}
      {saveSuccess && (
        <div className="alert alert-success mb-4">
          <Check size={16} aria-hidden /> Changes saved.
        </div>
      )}

      <div className="grid grid-2 split" style={{ gap: 'var(--space-6)', alignItems: 'start' }}>
        {/* Source document */}
        <div className="card card-flush">
          <div className="card-header">
            <h4>Source</h4>
            <a
              href={fileHref}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost btn-sm btn-icon"
              aria-label="Open original in new tab"
            >
              <ExternalLink size={14} aria-hidden />
            </a>
          </div>

          <div
            className="flex items-center justify-center"
            style={{ background: 'var(--canvas-soft)', minHeight: 520, maxHeight: '75vh', overflow: 'auto' }}
          >
            {document.preview_path ? (
              <img
                src={getPreviewUrl(document.id)}
                alt={`Preview of ${document.filename}`}
                style={{ maxWidth: '100%', height: 'auto', display: 'block' }}
              />
            ) : document.mime_type === 'application/pdf' ? (
              <iframe
                src={fileHref}
                title={`${document.filename} preview`}
                style={{ width: '100%', height: 600, border: 'none' }}
              />
            ) : (
              <div className="empty-state">
                <p>No preview was generated for this format.</p>
                <a
                  href={fileHref}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary btn-sm"
                >
                  Open file
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Extracted data */}
        <div className="card stack-5">
          <div className="flex items-center justify-between gap-3">
            <h3>Extracted data</h3>
            <span className="badge badge-secondary">Local extraction</span>
          </div>

          {mathMismatch && (
            <div className="alert alert-warning">
              <AlertTriangle size={16} aria-hidden />
              <span>
                <strong>Totals do not reconcile.</strong>{' '}
                {numSubtotal.toFixed(2)} + {numTax.toFixed(2)} = {(numSubtotal + numTax).toFixed(2)},
                but the total reads {numTotal.toFixed(2)}.
              </span>
            </div>
          )}

          <div className="grid grid-2">
            <div>
              <label className="form-label" htmlFor="doc-type">Document type</label>
              <select
                id="doc-type"
                className="form-control"
                value={docType}
                onChange={e => setDocType(e.target.value as DocumentType)}
              >
                {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            <div>
              <label className="form-label" htmlFor="doc-vendor">Vendor</label>
              <input
                id="doc-vendor"
                className="form-control"
                placeholder="Who issued this document"
                value={vendor}
                onChange={e => setVendor(e.target.value)}
              />
            </div>

            <div>
              <label className="form-label" htmlFor="doc-number">Document number</label>
              <input
                id="doc-number"
                className="form-control"
                placeholder="Reference on the document"
                value={docNumber}
                onChange={e => setDocNumber(e.target.value)}
              />
            </div>

            <div>
              <label className="form-label" htmlFor="doc-currency">Currency</label>
              <input
                id="doc-currency"
                className="form-control"
                placeholder="USD, EUR, GBP…"
                value={currency}
                onChange={e => setCurrency(e.target.value)}
              />
            </div>

            <div>
              <label className="form-label" htmlFor="doc-issue-date">Issue date</label>
              <input
                id="doc-issue-date"
                type="date"
                className="form-control"
                value={issueDate}
                onChange={e => setIssueDate(e.target.value)}
              />
            </div>

            <div>
              <label className="form-label" htmlFor="doc-due-date">Due date</label>
              <input
                id="doc-due-date"
                type="date"
                className="form-control"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
              />
            </div>

            <div>
              <label className="form-label" htmlFor="doc-subtotal">Subtotal</label>
              <input
                id="doc-subtotal"
                type="number"
                step="0.01"
                className="form-control mono"
                placeholder="0.00"
                value={subtotal}
                onChange={e => setSubtotal(e.target.value)}
              />
            </div>

            <div>
              <label className="form-label" htmlFor="doc-tax">Tax</label>
              <input
                id="doc-tax"
                type="number"
                step="0.01"
                className="form-control mono"
                placeholder="0.00"
                value={taxAmount}
                onChange={e => setTaxAmount(e.target.value)}
              />
            </div>

            <div className="col-span-2">
              <label className="form-label" htmlFor="doc-total">Total</label>
              <input
                id="doc-total"
                type="number"
                step="0.01"
                className="form-control mono"
                placeholder="0.00"
                style={{ fontSize: 'var(--text-lg)', fontWeight: 550 }}
                value={totalAmount}
                onChange={e => setTotalAmount(e.target.value)}
              />
            </div>

            <div className="col-span-2">
              <label className="form-label" htmlFor="doc-payment-terms">Payment terms</label>
              <input
                id="doc-payment-terms"
                className="form-control"
                placeholder="Net 30, due on receipt…"
                value={paymentTerms}
                onChange={e => setPaymentTerms(e.target.value)}
              />
            </div>

            <div className="col-span-2">
              <label className="form-label" htmlFor="doc-notes">Notes</label>
              <textarea
                id="doc-notes"
                className="form-control"
                rows={2}
                placeholder="Context for bookkeeping"
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </div>
          </div>

          <TagEditor
            documentId={document.id}
            tags={document.tags}
            value={newTagInput}
            onChange={setNewTagInput}
            onMutated={async () => setDocument(await getDocument(document.id))}
            onError={setError}
          />

          {document.fields.length > 0 && (
            <div className="divider-dashed" style={{ paddingTop: 'var(--space-4)' }}>
              <div className="form-label">Extraction audit trail</div>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 'var(--space-2)' }}>
                {document.fields.map(f => (
                  <div key={f.id} className="field-row">
                    <span className="text-muted capitalize">{f.field_name.replace(/_/g, ' ')}</span>
                    <span className={`value ${f.user_edited ? 'text-accent' : f.confidence > 0.8 ? 'text-ink' : 'text-warn'}`}>
                      {f.user_edited ? 'edited' : `${Math.round(f.confidence * 100)}%`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div
            className="flex items-center justify-end gap-3 divider"
            style={{ paddingTop: 'var(--space-4)' }}
          >
            <button className="btn btn-secondary" onClick={() => handleSave(false)} disabled={saving}>
              Save draft
            </button>
            <button className="btn btn-primary" onClick={() => handleSave(true)} disabled={saving}>
              <Check size={16} aria-hidden />
              {document.user_confirmed ? 'Save changes' : 'Confirm document'}
            </button>
          </div>
        </div>
      </div>

      {deleteModalOpen && (
        <ConfirmModal
          title="Delete document"
          message={`This permanently deletes "${document.filename}", the stored original, and all extracted records.`}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setDeleteModalOpen(false)}
          danger
        />
      )}
    </div>
  );
}

function TagEditor({
  documentId, tags, value, onChange, onMutated, onError,
}: {
  documentId: string;
  tags: { id: string; name: string }[];
  value: string;
  onChange: (v: string) => void;
  onMutated: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    try {
      await fn();
      await onMutated();
    } catch (err) {
      onError(errorMessage(err, fallback));
    }
  };

  return (
    <div className="divider-dashed" style={{ paddingTop: 'var(--space-4)' }}>
      <div className="form-label flex items-center gap-2">
        <TagIcon size={12} aria-hidden /> Tags
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        {tags.length === 0 && <span className="text-xs text-muted">No tags yet.</span>}
        {tags.map(tag => (
          <span key={tag.id} className="tag-chip">
            {tag.name}
            <button
              type="button"
              aria-label={`Remove tag ${tag.name}`}
              onClick={() => run(
                () => removeTagFromDocument(documentId, tag.id),
                'Failed to remove tag',
              )}
            >
              <X size={11} aria-hidden />
            </button>
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          className="form-control"
          style={{ maxWidth: 260 }}
          placeholder="Add a tag — Travel, Software…"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key !== 'Enter' || !value.trim()) return;
            e.preventDefault();
            run(
              () => addTagToDocument(documentId, value.trim()),
              'Failed to add tag',
            ).then(() => onChange(''));
          }}
        />
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={!value.trim()}
          onClick={() => run(
            () => addTagToDocument(documentId, value.trim()),
            'Failed to add tag',
          ).then(() => onChange(''))}
        >
          <Plus size={14} aria-hidden /> Add
        </button>
      </div>
    </div>
  );
}
