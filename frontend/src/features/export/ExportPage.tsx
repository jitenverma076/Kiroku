import { useState } from 'react';
import { Download, CheckCircle, Table } from 'lucide-react';
import { exportCsv, downloadBlob, listDocuments, errorMessage } from '../../services/api';
import type { DocumentType } from '../../types';
import PageHeader from '../../components/ui/PageHeader';

const SCHEMA: Array<[string, string, string]> = [
  ['id', 'UUID', 'Unique document identifier'],
  ['filename', 'String', 'Original uploaded filename'],
  ['doc_type', 'Enum', 'invoice · receipt · bill · credit_note'],
  ['vendor', 'String', 'Vendor or merchant name'],
  ['doc_number', 'String', 'Invoice or receipt reference'],
  ['issue_date', 'YYYY-MM-DD', 'Date on the document'],
  ['currency', 'ISO 4217', 'USD, EUR, GBP, …'],
  ['subtotal, tax_amount, total_amount', 'Decimal', 'Totals, two decimal places'],
  ['user_confirmed', 'Boolean', 'true when a human verified the row'],
  ['tags', 'List', 'Semicolon-separated categories'],
];

export default function ExportPage() {
  const [exporting, setExporting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [onlyConfirmed, setOnlyConfirmed] = useState(true);
  const [selectedType, setSelectedType] = useState<DocumentType | 'all'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    setSuccessMessage(null);
    try {
      let documentIds: string[] | undefined;

      if (onlyConfirmed || selectedType !== 'all' || dateFrom || dateTo) {
        const res = await listDocuments({
          status: onlyConfirmed ? 'confirmed' : undefined,
          doc_type: selectedType !== 'all' ? selectedType : undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          page_size: 10000,
        });
        documentIds = res.documents.map(d => d.id);
        if (documentIds.length === 0) {
          setError('No documents match these filters — nothing to export.');
          return;
        }
      }

      const blob = await exportCsv(documentIds);
      downloadBlob(blob, `kiroku-export-${new Date().toISOString().split('T')[0]}.csv`);
      setSuccessMessage('CSV downloaded.');
    } catch (err) {
      setError(errorMessage(err, 'Export failed. Check that the local backend is running.'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="narrow">
      <PageHeader
        title="Export"
        description="Download your records as a CSV for Excel, your accounting tool, or your accountant."
      />

      {error && <div className="alert alert-danger mb-4">{error}</div>}
      {successMessage && (
        <div className="alert alert-success mb-4">
          <CheckCircle size={16} aria-hidden /> {successMessage}
        </div>
      )}

      <div>
        <section className="section">

          <label className="flex items-start gap-3 mb-4" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={onlyConfirmed}
              onChange={e => setOnlyConfirmed(e.target.checked)}
              style={{ width: 16, height: 16, marginTop: 3 }}
            />
            <span>
              <span className="font-semibold text-ink">Only human-confirmed documents</span>
              <span className="text-sm text-muted" style={{ display: 'block' }}>
                Recommended — keeps unreviewed extractions out of your books.
              </span>
            </span>
          </label>

          <div className="grid grid-3">
            <div>
              <label className="form-label" htmlFor="export-type">Document type</label>
              <select
                id="export-type"
                className="form-control"
                value={selectedType}
                onChange={e => setSelectedType(e.target.value as DocumentType | 'all')}
              >
                <option value="all">All types</option>
                <option value="invoice">Invoices</option>
                <option value="receipt">Receipts</option>
                <option value="bill">Bills</option>
                <option value="credit_note">Credit notes</option>
              </select>
            </div>

            <div>
              <label className="form-label" htmlFor="export-date-from">From</label>
              <input
                id="export-date-from"
                type="date"
                className="form-control"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
              />
            </div>

            <div>
              <label className="form-label" htmlFor="export-date-to">To</label>
              <input
                id="export-date-to"
                type="date"
                className="form-control"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-6">
            <button className="btn btn-primary" onClick={handleExport} disabled={exporting}>
              <Download size={16} aria-hidden />
              {exporting ? 'Generating CSV…' : 'Download CSV'}
            </button>
          </div>
        </section>

        <section className="section">
          <div className="card-title">
            <div className="flex items-center gap-2">
              <Table size={16} className="text-muted" aria-hidden />
              <h4>CSV schema</h4>
            </div>
            <span className="badge badge-secondary">UTF-8 · RFC-4180</span>
          </div>

          <div className="table-scroll card card-flush">
            <table className="table">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Type</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {SCHEMA.map(([col, type, desc]) => (
                  <tr key={col}>
                    <td className="mono text-ink">{col}</td>
                    <td className="text-muted">{type}</td>
                    <td className="text-body">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

      </div>
    </div>
  );
}
