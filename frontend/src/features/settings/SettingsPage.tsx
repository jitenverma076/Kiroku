import { useState, useEffect } from 'react';
import { Tag as TagIcon, Plus, Trash2 } from 'lucide-react';
import { getSettings, listTags, createTag, deleteTag, errorMessage } from '../../services/api';
import type { AppSettings, Tag } from '../../types';
import PageHeader from '../../components/ui/PageHeader';

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTagName, setNewTagName] = useState('');
  const [tagError, setTagError] = useState<string | null>(null);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    const [s, t] = await Promise.all([
      getSettings().catch(() => null),
      listTags().catch(() => [] as Tag[]),
    ]);
    setSettings(s);
    setTags(t);
    setLoading(false);
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    setTagError(null);
    try {
      await createTag(newTagName.trim());
      setNewTagName('');
      setTags(await listTags());
    } catch (err) {
      setTagError(errorMessage(err, 'Could not create that category'));
    }
  };

  const handleDeleteTag = async (tagId: string) => {
    setTagError(null);
    try {
      await deleteTag(tagId);
      setTags(prev => prev.filter(t => t.id !== tagId));
    } catch (err) {
      setTagError(errorMessage(err, 'Could not delete that category'));
    }
  };

  if (loading) {
    return (
      <div className="empty-state">
        <div className="spinner spinner-lg" role="status" aria-label="Loading" />
        <p>Loading settings…</p>
      </div>
    );
  }

  const caps = settings?.capabilities;
  const bytes = settings?.storage.total_bytes ?? 0;
  const size = bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

  return (
    <div className="narrow">
      <PageHeader
        title="Settings"
        description="Categories for your expenses, and what this copy of Kiroku can read."
        actions={<span className="badge badge-secondary">v{settings?.app.version ?? '1.0.0'}</span>}
      />

      <div>
        <section className="section">
          <div className="card-title">
            <TagIcon size={16} className="text-muted" aria-hidden />
            <h4>Categories</h4>
          </div>
          <p className="text-sm mb-4">
            Group expenses for tax time. Categories appear on each document and in CSV exports.
          </p>

          {tagError && <div className="alert alert-danger mb-3">{tagError}</div>}

          <div className="flex items-center gap-2 mb-4">
            <label className="sr-only" htmlFor="new-category">New category</label>
            <input
              id="new-category"
              className="form-control"
              style={{ maxWidth: 320 }}
              placeholder="Hosting, Travel, Subcontractors…"
              value={newTagName}
              onChange={e => setNewTagName(e.target.value)}
              onKeyDown={e => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                handleCreateTag();
              }}
            />
            <button className="btn btn-secondary btn-sm" onClick={handleCreateTag} disabled={!newTagName.trim()}>
              <Plus size={14} aria-hidden /> Add
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {tags.length === 0 && <p className="text-sm text-muted">No categories yet.</p>}
            {tags.map(t => (
              <span key={t.id} className="tag-chip">
                {t.name}
                {t.document_count !== undefined && (
                  <span className="text-muted mono">{t.document_count}</span>
                )}
                <button type="button" onClick={() => handleDeleteTag(t.id)} aria-label={`Delete ${t.name}`}>
                  <Trash2 size={11} aria-hidden />
                </button>
              </span>
            ))}
          </div>
        </section>

        <section className="section">
          <div className="card-title"><h4>File support</h4></div>
          <p className="text-sm mb-4">
            Kiroku reads the text layer of PDFs. Scanned pages and photos need OCR, which the
            browser build does not include yet — import them and fill the fields in by hand.
          </p>
          <div>
            <div className="field-row">
              <span>PDF text</span>
              <span className={caps?.pdfplumber ? 'text-accent' : 'text-muted'}>
                {caps?.pdfplumber ? 'Ready' : 'Unavailable'}
              </span>
            </div>
            <div className="field-row">
              <span>Scans and photos (OCR)</span>
              <span className={caps?.tesseract_ocr ? 'text-accent' : 'text-warn'}>
                {caps?.tesseract_ocr ? 'Ready' : 'Not in this build'}
              </span>
            </div>
            <div className="field-row">
              <span>Page previews</span>
              <span className={caps?.pdf_preview ? 'text-accent' : 'text-muted'}>
                {caps?.pdf_preview ? 'Ready' : 'Opens the original'}
              </span>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="card-title"><h4>Storage</h4></div>
          <p className="text-sm">
            {settings?.storage.total_files ?? 0} file
            {settings?.storage.total_files === 1 ? '' : 's'}, {size} on this device. Documents and
            their records never leave it, and are not encrypted at rest — turn on full-disk
            encryption if the machine is shared. Clearing site data erases them.
          </p>
        </section>
      </div>
    </div>
  );
}
