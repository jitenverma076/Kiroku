import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Search, X, Download, Trash2, RefreshCw, Upload } from 'lucide-react';
import { listDocuments, deleteDocument, getStats, exportCsv, downloadBlob } from '../../services/api';
import type { DocumentSummary, SearchFilters, DocumentType, DocumentStatus, Stats } from '../../types';
import DocumentCard from './DocumentCard';
import PageHeader from '../../components/ui/PageHeader';
import ConfirmModal from '../../components/ui/ConfirmModal';

interface Props {
  onStatsChange: (reviewCount: number) => void;
}

const DOC_TYPES: Array<{ value: DocumentType; label: string }> = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'receipt', label: 'Receipt' },
  { value: 'bill', label: 'Bill' },
  { value: 'credit_note', label: 'Credit Note' },
  { value: 'unknown', label: 'Unknown' },
];

const STATUSES: Array<{ value: DocumentStatus; label: string }> = [
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'review_needed', label: 'Review Needed' },
  { value: 'error', label: 'Error' },
];

const DEFAULT_FILTERS: SearchFilters = { sort_by: 'imported_at', sort_dir: 'desc', page_size: 20 };

export default function DocumentsPage({ onStatsChange }: Props) {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');

  // Debounce the typed query; `query` is what actually drives the request.
  useEffect(() => {
    const t = setTimeout(() => { setQuery(searchInput); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listDocuments({ ...filters, page, query: query || undefined });
      setDocuments(result.documents);
      setTotal(result.total);
      setTotalPages(result.total_pages);
      const s = await getStats();
      setStats(s);
      onStatsChange(s.by_status?.review_needed ?? 0);
    } catch (e) {
      console.error('Failed to load documents:', e);
    } finally {
      setLoading(false);
    }
  }, [filters, page, query, onStatsChange]);

  useEffect(() => { load(); }, [load]);

  const handleBulkDelete = async () => {
    await Promise.all(Array.from(selected).map(id => deleteDocument(id)));
    setSelected(new Set());
    setBulkDeleteOpen(false);
    load();
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const ids = selected.size > 0 ? Array.from(selected) : undefined;
      const blob = await exportCsv(ids);
      downloadBlob(blob, `kiroku_${new Date().toISOString().split('T')[0]}.csv`);
    } catch (e) {
      console.error('Export failed:', e);
    } finally {
      setExporting(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const setFilter = (patch: Partial<SearchFilters>) => {
    setFilters(f => ({ ...f, ...patch }));
    setPage(1);
  };

  const filtersActive = Boolean(
    filters.doc_type || filters.status || filters.date_from || filters.date_to,
  );

  return (
    <div>
      <PageHeader
        title="Documents"
        description="Everything you have imported, newest first."
        actions={
          <>
            {selected.size > 0 && (
              <button className="btn btn-danger btn-sm" onClick={() => setBulkDeleteOpen(true)}>
                <Trash2 size={14} aria-hidden /> Delete {selected.size}
              </button>
            )}
            <button className="btn btn-secondary btn-sm" onClick={handleExport} disabled={exporting}>
              <Download size={14} aria-hidden />
              {exporting ? 'Exporting…' : selected.size > 0 ? `Export ${selected.size}` : 'Export all'}
            </button>
            <button className="btn btn-secondary btn-sm btn-icon" onClick={load} aria-label="Refresh">
              <RefreshCw size={14} className={loading ? 'spin' : ''} aria-hidden />
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/import')}>
              <Upload size={14} aria-hidden /> Import
            </button>
          </>
        }
      />

      <div className="stats-row">
        <div>
          <div className="stat-label">Documents</div>
          <div className="stat-value">{stats?.total_documents ?? total}</div>
        </div>
        <div>
          <div className="stat-label">Confirmed</div>
          <div className="stat-value accent">{stats?.by_status?.confirmed ?? 0}</div>
        </div>
        <div>
          <div className="stat-label">Awaiting review</div>
          <div className="stat-value warn">{stats?.by_status?.review_needed ?? 0}</div>
        </div>
        {/* ponytail: /stats sums total_amount across currencies, so this is only
            meaningful in a single-currency workspace. Per-currency breakdown if
            multi-currency users show up. */}
        <div>
          <div className="stat-label">Tracked value</div>
          <div className="stat-value">
            {(stats?.total_value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </div>
        </div>
      </div>

      <div className="search-bar mb-4">
          <Search size={16} className="text-muted" aria-hidden />
          <input
            type="search"
            placeholder="Search vendor, document number, or notes…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            aria-label="Search documents"
          />
          {searchInput && (
            <button
              className="btn btn-ghost btn-sm btn-icon"
              onClick={() => setSearchInput('')}
              aria-label="Clear search"
            >
              <X size={14} aria-hidden />
            </button>
          )}
        </div>

      <div className="filter-bar">
        <select
          className="form-control form-control-auto"
          value={filters.doc_type ?? ''}
            onChange={e => setFilter({ doc_type: (e.target.value || undefined) as DocumentType })}
            aria-label="Filter by type"
          >
            <option value="">All types</option>
            {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>

          <select
            className="form-control form-control-auto"
            value={filters.status ?? ''}
            onChange={e => setFilter({ status: (e.target.value || undefined) as DocumentStatus })}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

          <input
            type="date"
            className="form-control form-control-auto"
            value={filters.date_from ?? ''}
            onChange={e => setFilter({ date_from: e.target.value || undefined })}
            aria-label="From date"
          />
          <span className="text-xs text-muted">to</span>
          <input
            type="date"
            className="form-control form-control-auto"
            value={filters.date_to ?? ''}
            onChange={e => setFilter({ date_to: e.target.value || undefined })}
            aria-label="To date"
          />

          <select
            className="form-control form-control-auto"
            value={`${filters.sort_by}:${filters.sort_dir}`}
            onChange={e => {
              const [sort_by, sort_dir] = e.target.value.split(':');
              setFilter({ sort_by, sort_dir: sort_dir as 'asc' | 'desc' });
            }}
            aria-label="Sort by"
          >
            <option value="imported_at:desc">Newest first</option>
            <option value="imported_at:asc">Oldest first</option>
            <option value="total_amount:desc">Highest amount</option>
            <option value="total_amount:asc">Lowest amount</option>
            <option value="vendor:asc">Vendor A–Z</option>
            <option value="issue_date:desc">Issue date</option>
          </select>

        {filtersActive && (
          <button className="btn btn-ghost btn-sm" onClick={() => setFilters(DEFAULT_FILTERS)}>
            <X size={12} aria-hidden /> Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <div className="empty-state">
          <div className="spinner spinner-lg" role="status" aria-label="Loading" />
          <p>Loading documents…</p>
        </div>
      ) : documents.length === 0 ? (
        <div className="empty-state">
          <FileText className="empty-state-icon" aria-hidden />
          <h3>No documents found</h3>
          <p>
            {query || filtersActive
              ? 'Nothing matches the current search and filters.'
              : 'Import your first invoice, receipt, or bill to get started.'}
          </p>
          {!query && !filtersActive && (
            <button className="btn btn-primary" onClick={() => navigate('/import')}>
              <Upload size={16} aria-hidden /> Import documents
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="document-grid">
            {documents.map(doc => (
              <DocumentCard
                key={doc.id}
                document={doc}
                selected={selected.has(doc.id)}
                onSelect={() => toggleSelect(doc.id)}
                onClick={() => navigate(`/documents/${doc.id}`)}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              >
                Previous
              </button>
              <span className="pagination-info">{page} / {totalPages}</span>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {bulkDeleteOpen && (
        <ConfirmModal
          title={`Delete ${selected.size} documents`}
          message={`This permanently deletes ${selected.size} documents and all extracted data. This cannot be undone.`}
          confirmLabel={`Delete ${selected.size}`}
          onConfirm={handleBulkDelete}
          onCancel={() => setBulkDeleteOpen(false)}
          danger
        />
      )}
    </div>
  );
}
