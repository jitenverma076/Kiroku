import { useEffect, useState } from 'react';
import { FileText, AlertCircle, CheckCircle, Clock, XCircle, Check } from 'lucide-react';
import type { DocumentSummary } from '../../types';
import { getPreviewUrl } from '../../services/api';

interface Props {
  document: DocumentSummary;
  selected: boolean;
  onSelect: () => void;
  onClick: () => void;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', INR: '₹', AUD: 'A$', CAD: 'C$',
};

function formatAmount(amount: number | null, currency: string | null): string {
  if (amount == null) return '—';
  const sym = currency ? (CURRENCY_SYMBOLS[currency] ?? `${currency} `) : '$';
  return `${sym}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? dateStr
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_META: Record<string, { label: string; Icon: typeof Clock; className: string }> = {
  confirmed:     { label: 'Confirmed',    Icon: CheckCircle, className: 'text-accent' },
  review_needed: { label: 'Needs review', Icon: AlertCircle, className: 'text-warn' },
  processing:    { label: 'Processing',   Icon: Clock,       className: 'text-muted' },
  error:         { label: 'Error',        Icon: XCircle,     className: 'text-danger' },
  pending:       { label: 'Pending',      Icon: Clock,       className: 'text-muted' },
};

export default function DocumentCard({ document: doc, selected, onSelect, onClick }: Props) {
  const [preview, setPreview] = useState('');

  useEffect(() => {
    if (!doc.preview_path) return;
    let active = true;
    getPreviewUrl(doc.id).then(url => { if (active) setPreview(url); });
    return () => { active = false; };
  }, [doc.id, doc.preview_path]);

  const status = STATUS_META[doc.status] ?? STATUS_META.pending;
  const { Icon } = status;
  const confidencePct = doc.confidence != null ? Math.round(doc.confidence * 100) : null;

  return (
    <article className={`document-card${doc.status === 'review_needed' ? ' review-needed' : ''}`}>
      <div className="document-card-preview">
        {preview ? (
          <img
            src={preview}
            alt=""
            loading="lazy"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="preview-placeholder">
            <FileText size={28} aria-hidden />
            <span>No preview</span>
          </div>
        )}

        <label className={`card-select${selected ? ' checked' : ''}`}>
          <input
            type="checkbox"
            className="sr-only"
            checked={selected}
            onChange={onSelect}
            aria-label={`Select ${doc.filename}`}
          />
          {selected && <Check size={13} strokeWidth={3} aria-hidden />}
        </label>

        {doc.doc_type && (
          <span
            className={`badge badge-${doc.doc_type} capitalize`}
            style={{ position: 'absolute', top: 8, right: 8 }}
          >
            {doc.doc_type.replace('_', ' ')}
          </span>
        )}
      </div>

      <div
        className="document-card-body"
        role="button"
        tabIndex={0}
        aria-label={`Open ${doc.filename}`}
        onClick={onClick}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      >
        <div className="document-card-filename" title={doc.filename}>{doc.filename}</div>
        <div className="document-card-vendor">
          {doc.vendor || 'Vendor not detected'}
          {doc.issue_date && ` · ${formatDate(doc.issue_date)}`}
        </div>

        <div className="document-card-meta">
          <span className={`flex items-center gap-2 text-xs ${status.className}`}>
            <Icon size={13} aria-hidden />
            {status.label}
            {confidencePct != null && doc.status !== 'confirmed' && (
              <span className="mono text-muted">{confidencePct}%</span>
            )}
          </span>
          <span className="document-card-amount">
            {formatAmount(doc.total_amount, doc.currency)}
          </span>
        </div>

        {doc.tags.length > 0 && (
          <div className="flex gap-1 flex-wrap mt-3">
            {doc.tags.slice(0, 3).map(tag => (
              <span key={tag.id} className="tag-chip">{tag.name}</span>
            ))}
            {doc.tags.length > 3 && <span className="tag-chip">+{doc.tags.length - 3}</span>}
          </div>
        )}
      </div>
    </article>
  );
}
