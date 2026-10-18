import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import {
  FileText, Upload, AlertCircle, Download, Settings, Menu, X,
} from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { getStats } from '../services/api';

import DocumentsPage from '../features/documents/DocumentsPage';
import ImportPage from '../features/documents/ImportPage';
import DocumentDetailPage from '../features/documents/DocumentDetailPage';
import ReviewQueuePage from '../features/review/ReviewQueuePage';
import ExportPage from '../features/export/ExportPage';
import SettingsPage from '../features/settings/SettingsPage';

const NAV = [
  { to: '/documents', label: 'Documents', icon: FileText },
  { to: '/import',    label: 'Import',    icon: Upload },
  { to: '/review',    label: 'Review',    icon: AlertCircle, badge: true },
  { to: '/export',    label: 'Export',    icon: Download },
  { to: '/settings',  label: 'Settings',  icon: Settings },
];

function Sidebar({ reviewCount, open, close }: { reviewCount: number; open: boolean; close: () => void }) {
  return (
    <>
      {open && <div className="scrim" onClick={close} aria-hidden />}
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="sidebar-logo">
          <div className="flex items-center gap-2">
            <img className="logo" src="/logo.svg" alt="" width="26" height="26" />
            <h1>Kiroku</h1>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Primary">
          {NAV.map(({ to, label, icon: Icon, badge }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              onClick={close}
            >
              <Icon size={16} aria-hidden />
              {label}
              {badge && reviewCount > 0 && (
                <span className="count" aria-label={`${reviewCount} awaiting review`}>
                  {reviewCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

      </aside>
    </>
  );
}

export default function App() {
  const [reviewCount, setReviewCount] = useState(0);
  const [navOpen, setNavOpen] = useState(false);

  const refreshStats = useCallback(() => {
    getStats()
      .then(s => setReviewCount(s.by_status?.review_needed ?? 0))
      .catch(() => { /* backend may not be up yet */ });
  }, []);

  useEffect(() => {
    refreshStats();
    const interval = setInterval(refreshStats, 30_000);
    return () => clearInterval(interval);
  }, [refreshStats]);

  return (
    <BrowserRouter>
      <div className="app-shell">
        <Sidebar reviewCount={reviewCount} open={navOpen} close={() => setNavOpen(false)} />

        <div className="main-content">
          {/* Only rendered below the sidebar breakpoint, where nav needs a trigger. */}
          <header className="topbar">
            <button
              className="btn btn-ghost btn-icon btn-sm"
              onClick={() => setNavOpen(v => !v)}
              aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={navOpen}
            >
              {navOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            <img className="logo" src="/logo.svg" alt="" width="22" height="22" />
            <span className="font-semibold">Kiroku</span>
          </header>

          <main className="page-body">
            <Routes>
              <Route path="/" element={<Navigate to="/documents" replace />} />
              <Route path="/documents" element={<DocumentsPage onStatsChange={setReviewCount} />} />
              <Route path="/documents/:id" element={<DocumentDetailPage />} />
              <Route path="/import" element={<ImportPage onImported={refreshStats} />} />
              <Route path="/review" element={<ReviewQueuePage onReviewed={refreshStats} />} />
              <Route path="/export" element={<ExportPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}
