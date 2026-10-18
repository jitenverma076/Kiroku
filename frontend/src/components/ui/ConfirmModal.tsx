import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="modal-content">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            {danger && <AlertTriangle size={18} className="text-danger" aria-hidden />}
            <h3 id="modal-title">{title}</h3>
          </div>
          <button
            className="btn btn-ghost btn-sm btn-icon"
            onClick={onCancel}
            aria-label="Close dialog"
            disabled={loading}
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        <p className="text-sm mb-6">{message}</p>

        <div className="flex justify-end gap-3">
          <button className="btn btn-secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? (
              <><span className="spinner spinner-sm" aria-hidden /> Working…</>
            ) : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
