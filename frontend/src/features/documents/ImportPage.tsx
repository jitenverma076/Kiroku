import { useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { Upload, FileText, CheckCircle, AlertCircle, XCircle, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { uploadDocument } from '../../services/api';
import type { UploadProgress } from '../../types';
import PageHeader from '../../components/ui/PageHeader';

interface Props {
  onImported?: () => void;
}

const ACCEPTED_TYPES = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/tiff': ['.tiff', '.tif'],
  'image/webp': ['.webp'],
  'image/bmp': ['.bmp'],
};

const FORMATS = [
  { ext: 'PDF',  desc: 'Native text or scanned' },
  { ext: 'JPEG', desc: 'Photographed receipts' },
  { ext: 'PNG',  desc: 'Screenshots and scans' },
  { ext: 'TIFF', desc: 'Scanner output' },
  { ext: 'WEBP', desc: 'Web images' },
  { ext: 'BMP',  desc: 'Legacy scans' },
];

const MAX_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_FILES = 50;

export default function ImportPage({ onImported }: Props) {
  const navigate = useNavigate();
  const [queue, setQueue] = useState<UploadProgress[]>([]);
  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState(false);

  const updateItem = (file: File, updates: Partial<UploadProgress>) => {
    setQueue(prev => prev.map(item => (item.file === file ? { ...item, ...updates } : item)));
  };

  const processFiles = async (files: File[]) => {
    if (files.length === 0) return;

    const items: UploadProgress[] = files.map(f => ({ file: f, status: 'queued' }));
    setQueue(items);
    setProcessing(true);
    setDone(false);

    for (const item of items) {
      updateItem(item.file, { status: 'uploading' });
      try {
        const result = await uploadDocument(item.file);
        updateItem(item.file, {
          status: result.duplicate?.type === 'exact' ? 'duplicate' : 'done',
          result,
        });
      } catch (e: unknown) {
        updateItem(item.file, {
          status: 'error',
          error: e instanceof Error ? e.message : 'Upload failed',
        });
      }
    }

    setProcessing(false);
    setDone(true);
    onImported?.();
  };

  const onDrop = (accepted: File[], rejected: FileRejection[]) => {
    processFiles(accepted.slice(0, MAX_FILES));

    if (rejected.length > 0) {
      setQueue(prev => [
        ...prev,
        ...rejected.map(r => ({
          file: r.file,
          status: 'error' as const,
          error: r.errors?.[0]?.message ?? 'Unsupported file or file too large',
        })),
      ]);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxSize: MAX_SIZE,
    maxFiles: MAX_FILES,
    disabled: processing,
  });

  const successCount = queue.filter(i => i.status === 'done').length;
  const errorCount = queue.filter(i => i.status === 'error').length;
  const dupCount = queue.filter(i => i.status === 'duplicate').length;

  return (
    <div className="narrow">
      <PageHeader
        title="Import documents"
        description="Add invoices, receipts, and bills. Kiroku reads the vendor, dates, and amounts from text-based PDFs; scans and photos import but need filling in by hand."
      />

      <div className="stack-6">
        <div
          {...getRootProps()}
          className={`drop-zone${isDragActive ? ' drag-active' : ''}`}
          aria-label="Upload documents"
        >
          <input {...getInputProps()} />
          <Upload className="drop-zone-icon" aria-hidden />
          {isDragActive ? (
            <p className="text-accent font-semibold">Drop to import…</p>
          ) : (
            <>
              <p className="font-semibold text-ink">Drop files here, or click to browse</p>
              <p className="text-sm text-muted mt-2">
                PDF, JPEG, PNG, TIFF, WEBP, BMP · up to 50 MB each · 50 files per batch
              </p>
            </>
          )}
        </div>

        {queue.length > 0 && (
          <div className="card card-flush">
            <div className="card-header">
              <h4>Processing queue</h4>
              {done && (
                <div className="flex gap-3 text-xs">
                  {successCount > 0 && <span className="text-accent">{successCount} imported</span>}
                  {dupCount > 0 && <span className="text-warn">{dupCount} duplicate</span>}
                  {errorCount > 0 && <span className="text-danger">{errorCount} failed</span>}
                </div>
              )}
            </div>

            <div className="card-body">
              <div className="upload-queue">
                {queue.map((item, i) => (
                  <div key={`${item.file.name}-${i}`} className="upload-item">
                    <FileText size={15} className="text-muted" aria-hidden />
                    <span className="upload-item-name" title={item.file.name}>{item.file.name}</span>
                    <UploadStatusIndicator item={item} />
                  </div>
                ))}
              </div>

              {done && (
                <div className="flex gap-3 mt-4">
                  {successCount > 0 && (
                    <button className="btn btn-primary btn-sm" onClick={() => navigate('/documents')}>
                      View imported <ArrowRight size={14} aria-hidden />
                    </button>
                  )}
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setQueue([]); setDone(false); }}
                  >
                    Import more
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {queue.length === 0 && (
          <section>
            <div className="card-title"><h4>Supported formats</h4></div>
            <div className="grid grid-3" style={{ gap: '0 var(--space-6)' }}>
              {FORMATS.map(f => (
                <div key={f.ext} className="field-row">
                  <span className="mono text-accent">{f.ext}</span>
                  <span className="text-muted">{f.desc}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function UploadStatusIndicator({ item }: { item: UploadProgress }) {
  switch (item.status) {
    case 'queued':
      return <span className="upload-item-status">Queued</span>;
    case 'uploading':
      return (
        <span className="upload-item-status">
          <span className="spinner spinner-sm" aria-hidden /> Processing…
        </span>
      );
    case 'done':
      return (
        <span className="upload-item-status done">
          <CheckCircle size={12} aria-hidden /> Imported
          {item.result?.duplicate?.type === 'probable' && (
            <AlertCircle size={12} className="text-warn" aria-label="Possible duplicate" />
          )}
        </span>
      );
    case 'duplicate':
      return (
        <span className="upload-item-status duplicate" title={item.result?.duplicate?.reason}>
          <AlertCircle size={12} aria-hidden /> Duplicate
        </span>
      );
    case 'error':
      return (
        <span className="upload-item-status error" title={item.error}>
          <XCircle size={12} aria-hidden /> {item.error?.slice(0, 40) ?? 'Error'}
        </span>
      );
    default:
      return null;
  }
}
