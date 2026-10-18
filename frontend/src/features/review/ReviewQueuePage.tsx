import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, FileText, ArrowRight, Check, RefreshCw } from 'lucide-react';
import { getReviewQueue, updateDocument } from '../../services/api';
import type { DocumentSummary } from '../../types';
import PageHeader from '../../components/ui/PageHeader';

interface Props {
  onReviewed?: () => void;
}

export default function ReviewQueuePage({ onReviewed }: Props) {
  const navigate = useNavigate();
  const [queue, setQueue] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);

  useEffect(() => { loadQueue(); }, []);

  const loadQueue = async () => {
    setLoading(true);
    try {
      setQueue(await getReviewQueue());
    } catch (err) {
      console.error('Failed to load review queue:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickConfirm = async (doc: DocumentSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    setActioningId(doc.id);
    try {
      await updateDocument(doc.id, { user_confirmed: true });
      setQueue(prev => prev.filter(item => item.id !== doc.id));
      onReviewed?.();
    } catch (err) {
      console.error('Failed to confirm document:', err);
    } finally {
      setActioningId(null);
    }
  };

  const handleConfirmAll = async () => {
    setLoading(true);
    try {
      for (const item of queue) {
        await updateDocument(item.id, { user_confirmed: true });
      }
      setQueue([]);
      onReviewed?.();
    } catch (err) {
      console.error('Failed to confirm all:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="empty-state">
        <div className="spinner spinner-lg" role="status" aria-label="Loading" />
        <p>Loading review queue…</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Review queue"
        description="Documents Kiroku was unsure about. Check the values, then confirm."
        actions={queue.length > 0 ? (
          <>
            <button className="btn btn-secondary btn-sm" onClick={loadQueue}>
              <RefreshCw size={14} aria-hidden /> Refresh
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleConfirmAll}>
              <CheckCircle size={14} aria-hidden /> Confirm all ({queue.length})
            </button>
          </>
        ) : undefined}
      />

      {queue.length === 0 ? (
        <div className="empty-state">
          <CheckCircle className="empty-state-icon text-accent" aria-hidden />
          <h3>Nothing to review</h3>
          <p>Every document has been confirmed.</p>
          <button className="btn btn-secondary" onClick={() => navigate('/documents')}>
            View all documents
          </button>
        </div>
      ) : (
        <div className="stack-4">
          <div className="card card-flush table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Type</th>
                  <th>Vendor</th>
                  <th>Issue date</th>
                  <th>Amount</th>
                  <th>Confidence</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {queue.map(doc => {
                  const confPct = Math.round((doc.confidence ?? 0) * 100);
                  const low = confPct < 60;
                  return (
                    <tr key={doc.id} className="hover-row" onClick={() => navigate(`/documents/${doc.id}`)}>
                      <td>
                        <div className="flex items-center gap-3">
                          <FileText size={16} className="text-muted" aria-hidden />
                          <div style={{ minWidth: 0 }}>
                            <div className="font-semibold truncate" style={{ maxWidth: 280 }}>
                              {doc.filename}
                            </div>
                            {doc.doc_number && (
                              <div className="text-xs text-muted mono">{doc.doc_number}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`badge badge-${doc.doc_type ?? 'unknown'} capitalize`}>
                          {(doc.doc_type ?? 'unknown').replace('_', ' ')}
                        </span>
                      </td>
                      <td className={doc.vendor ? '' : 'text-muted'}>{doc.vendor || '—'}</td>
                      <td className={`mono ${doc.issue_date ? '' : 'text-muted'}`}>{doc.issue_date || '—'}</td>
                      <td className="mono tabular">
                        {doc.total_amount != null
                          ? `${doc.currency ?? ''} ${doc.total_amount.toFixed(2)}`.trim()
                          : <span className="text-warn">missing</span>}
                      </td>
                      <td>
                        <span className="flex items-center gap-2">
                          <span
                            className="status-dot"
                            style={{ background: low ? 'var(--warn)' : 'var(--primary)' }}
                          />
                          <span className={`mono ${low ? 'text-warn' : 'text-muted'}`}>{confPct}%</span>
                        </span>
                      </td>
                      <td>
                        <div
                          className="flex items-center justify-end gap-2"
                          onClick={e => e.stopPropagation()}
                        >
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => navigate(`/documents/${doc.id}`)}
                          >
                            Open <ArrowRight size={14} aria-hidden />
                          </button>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={e => handleQuickConfirm(doc, e)}
                            disabled={actioningId === doc.id}
                          >
                            <Check size={14} aria-hidden /> Confirm
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
