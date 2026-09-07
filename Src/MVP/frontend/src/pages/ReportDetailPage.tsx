import { useState, useEffect } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { useSessionStore } from '../stores/sessionStore';
import { apiClient, streamDownload } from '../api/client';
import { StatusBadge } from '../components/shared/StatusBadge';
import { Spinner } from '../components/shared/Spinner';
import { ErrorState } from '../components/shared/ErrorState';
import { TextBlockRenderer } from '../components/report/TextBlockRenderer';
import { FindingBlockRenderer } from '../components/report/FindingBlockRenderer';
import { PolicyViolationRenderer } from '../components/report/PolicyViolationRenderer';
import { ProposalRenderer } from '../components/report/ProposalRenderer';
import { OPERATION_LABELS } from '../types';
import type { Report, ReportBlock, Severity } from '../types';

/**
 * ReportDetailPage — /reports/:id
 *
 * Fetches and renders a full report from GET /reports/:id.
 *
 * The report body is a polymorphic array of blocks dispatched to the
 * appropriate renderer based on each block's `kind` field:
 *  - 'text'            → TextBlockRenderer
 *  - 'finding'         → FindingBlockRenderer (OWASP findings, filterable by severity)
 *  - 'policy_violation'→ PolicyViolationRenderer
 *  - 'changelog_item'  → rendered inline as a timeline card
 *
 * If the report has a `proposal` (Docs agent), it is displayed below the body
 * via ProposalRenderer with a primary PR link button.
 *
 * Issue 12 — PDF export: the Export PDF button triggers a streaming binary
 * download via the streamDownload() utility, not a direct S3 URL.
 */
export function ReportDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const token = useSessionStore((s) => s.token);

  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pdf_loading, setPdfLoading] = useState(false);
  const [pdf_error, setPdfError] = useState('');

  // Severity filter for finding/policy reports.
  const [severity_filter, setSeverityFilter] = useState<Severity | 'all'>('all');

  useEffect(() => {
    async function fetch_report() {
      try {
        const response = await apiClient.get<Report>(`/reports/${id}`);
        setReport(response.data);
      } catch {
        setError('Impossibile caricare il report. Potrebbe essere stato eliminato.');
      } finally {
        setLoading(false);
      }
    }
    fetch_report();
  }, [id]);

  /** Triggers a streaming PDF download via the backend export endpoint. */
  async function handle_pdf_export() {
    if (!token) return;
    setPdfLoading(true);
    setPdfError('');
    try {
      const blob = await streamDownload(`/reports/${id}/export?format=pdf`, token);

      // Create a temporary anchor element to trigger the browser download dialog.
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `report-${id}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch {
      setPdfError('Errore durante il download del PDF. Riprova.');
    } finally {
      setPdfLoading(false);
    }
  }

  // ---- Render ----

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Spinner size="sm" />
        Caricamento report…
      </div>
    );
  }

  if (error || !report) {
    return (
      <ErrorState
        message={error || 'Report non trovato.'}
        action={
          <Link
            to="/reports"
            className="rounded bg-[#2277cc] px-3 py-1.5 text-sm text-white hover:bg-[#1a5fa8]"
          >
            Torna ai report
          </Link>
        }
      />
    );
  }

  /**
   * Filters and sorts the report blocks.
   * Finding and policy_violation blocks respect the severity filter.
   * All blocks are sorted by their `order` field (ascending).
   */
  const filtered_blocks: ReportBlock[] = report.body
    .filter((block) => {
      if (severity_filter === 'all') return true;
      if (block.kind === 'finding') return block.severity === severity_filter;
      if (block.kind === 'policy_violation') return true; // no severity on policy violations
      return true;
    })
    .sort((a, b) => a.order - b.order);

  // Check whether this report contains severity-filterable blocks.
  const has_findings = report.body.some(
    (b) => b.kind === 'finding' || b.kind === 'policy_violation',
  );

  const severity_options: Array<{ value: Severity | 'all'; label: string }> = [
    { value: 'all', label: 'Tutti' },
    { value: 'critical', label: 'Critico' },
    { value: 'high', label: 'Alto' },
    { value: 'medium', label: 'Medio' },
    { value: 'low', label: 'Basso' },
    { value: 'info', label: 'Info' },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <Link
            to="/reports"
            className="mb-2 block text-xs text-[#2277cc] hover:underline"
          >
            ← Torna ai report
          </Link>
          <h1 className="text-lg font-semibold text-[#2a2a2a]">
            {OPERATION_LABELS[report.operation] ?? report.operation}
          </h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
            <StatusBadge status={report.status} />
            <span>{new Date(report.generatedAt).toLocaleString('it-IT')}</span>
            {report.durationMs && (
              <span>{(report.durationMs / 1000).toFixed(1)}s</span>
            )}
          </div>
        </div>

        {/* PDF export button */}
        <button
          onClick={handle_pdf_export}
          disabled={pdf_loading}
          title="Esporta in PDF"
          className="flex shrink-0 items-center gap-2 rounded border border-[#cccccc] px-3 py-2 text-sm text-[#2a2a2a] hover:bg-gray-50 transition disabled:opacity-50"
        >
          {pdf_loading ? (
            <Spinner size="sm" />
          ) : (
            <svg
              className="h-4 w-4 text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          )}
          Esporta PDF
        </button>
      </div>

      {pdf_error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-[#cc2222]">
          {pdf_error}
        </div>
      )}

      {/* Summary */}
      {report.summary && (
        <div className="mb-6 rounded border border-[#cccccc] p-4 text-sm text-[#2a2a2a]">
          {report.summary}
        </div>
      )}

      {/* Severity filter (only for security/policy reports) */}
      {has_findings && (
        <div className="mb-4 flex flex-wrap items-center gap-1">
          <span className="text-xs font-medium text-gray-500 mr-1">Filtra per severità:</span>
          {severity_options.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setSeverityFilter(value)}
              className={[
                'rounded px-2.5 py-1 text-xs font-medium transition',
                severity_filter === value
                  ? 'bg-[#2a2a2a] text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Report body — block dispatcher */}
      <div className="flex flex-col gap-3">
        {filtered_blocks.map((block) => {
          switch (block.kind) {
            case 'text':
              return <TextBlockRenderer key={block.order} block={block} />;

            case 'finding':
              return <FindingBlockRenderer key={block.order} block={block} />;

            case 'policy_violation':
              return <PolicyViolationRenderer key={block.order} block={block} />;

            case 'changelog_item':
              return (
                <div
                  key={block.order}
                  className="rounded border border-[#cccccc] bg-white p-4"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-500">
                      {block.issueRef}
                    </span>
                    <span className="text-sm font-semibold text-[#2a2a2a]">{block.title}</span>
                  </div>
                  <p className="text-sm text-gray-500 leading-relaxed">{block.detail}</p>
                </div>
              );

            default:
              // Guard against unknown block kinds from future backend versions.
              return null;
          }
        })}
      </div>

      {/* Proposal section (Docs agent) */}
      {report.proposal && (
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-[#2a2a2a]">Proposta di modifica</h2>
          <ProposalRenderer proposal={report.proposal} />
        </div>
      )}

      {/* Empty state after filtering */}
      {filtered_blocks.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">
          Nessun elemento per il filtro selezionato.
        </p>
      )}
    </div>
  );
}
