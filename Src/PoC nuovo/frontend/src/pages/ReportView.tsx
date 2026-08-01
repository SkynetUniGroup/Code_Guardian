import { useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { getReport } from '../utils/api';
import { useAppStore } from '../stores/useAppStore';
import ReportRenderer from '../components/ReportRenderer';

// Sotto-componente dedicato per il rendering della Proposta (Diff)
const DiffViewer = ({ proposal }: { proposal: any }) => {
  if (!proposal || !proposal.diffUnified) return null;

  const lines = proposal.diffUnified.split('\n');

  return (
    <div className="mt-8 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-200 px-5 py-4 flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Proposta di modifica (Diff)</h2>
          <p className="text-sm text-gray-500 font-mono mt-1">File: {proposal.targetPath}</p>
        </div>
        {proposal.language && proposal.language !== 'auto' && (
          <span className="text-xs font-bold text-blue-700 bg-blue-100 px-2.5 py-1 rounded uppercase tracking-wide">
            {proposal.language}
          </span>
        )}
      </div>
      
      <div className="overflow-x-auto">
        <pre className="text-sm font-mono leading-tight py-4">
          {lines.map((line: string, index: number) => {
            let lineClass = "px-5 py-0.5 whitespace-pre";
            
            if (line.startsWith('+') && !line.startsWith('+++')) {
              lineClass += " bg-green-50 text-green-800";
            } else if (line.startsWith('-') && !line.startsWith('---')) {
              lineClass += " bg-red-50 text-red-800";
            } else if (line.startsWith('@@')) {
              lineClass += " text-blue-600 bg-blue-50 py-1.5 my-1.5 font-bold";
            } else if (line.startsWith('+++') || line.startsWith('---')) {
              lineClass += " font-bold text-gray-800 pb-2";
            } else {
              lineClass += " text-gray-600";
            }

            return (
              <div key={index} className={lineClass}>
                {line || ' '}
              </div>
            );
          })}
        </pre>
      </div>
      
      {/* Disclaimer per il rispetto del Vincolo RS.3 delle specifiche */}
      <div className="bg-blue-50 px-5 py-3 border-t border-blue-100 flex items-start gap-3">
        <svg className="w-5 h-5 text-blue-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <p className="text-sm text-blue-800">
          <strong>Azione richiesta:</strong> L'applicazione di questa proposta al repository è un atto umano e resta a carico dell'utente. Il sistema Code Guardian opera in sola lettura.
        </p>
      </div>
    </div>
  );
};

export default function ReportView() {
  const { reportId } = useParams({ select: ['reportId'] });
  const { reports, addReport } = useAppStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (reportId) {
      const fetchReport = async () => {
        try {
          if (!reports[reportId]) {
            const report = await getReport(reportId);
            addReport(report);
          }
        } catch (error) {
          console.error('Failed to fetch report:', error);
        } finally {
          setLoading(false);
        }
      };
      fetchReport();
    }
  }, [reportId, reports, addReport]);

  const report = reportId ? reports[reportId] : null;

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-600">Caricamento report...</span>
      </div>
    );
  }

  if (!report) {
    return <div className="p-8 text-center text-gray-500">Report non trovato.</div>;
  }

  return (
    <div className="max-w-4xl mx-auto py-8">
      <div className="flex justify-between items-center mb-8 border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Analisi: {report.operation}</h1>
          <p className="text-gray-500 mt-1">Generato il {new Date(report.generatedAt).toLocaleString()}</p>
        </div>
        <span className={`px-4 py-1.5 rounded-full text-sm font-bold uppercase tracking-wider ${
          report.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          {report.status}
        </span>
      </div>

      {report.summary && (
        <div className="mb-8 p-5 bg-white border border-gray-200 shadow-sm rounded-xl">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Riassunto</h2>
          <p className="text-gray-700 leading-relaxed">{report.summary}</p>
        </div>
      )}

      {report.error && (
        <div className="mb-8 p-5 bg-red-50 border border-red-200 rounded-xl shadow-sm">
          <h2 className="text-lg font-semibold text-red-800 mb-2">Errore di Analisi</h2>
          <div className="text-sm font-mono bg-white p-3 rounded border border-red-100 text-red-900 mb-2">
            <strong>Tipo:</strong> {report.error.kind} | <strong>Fase:</strong> {report.error.stage}
          </div>
          <p className="text-red-700 leading-relaxed">{report.error.message}</p>
        </div>
      )}

      {report.body && report.body.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Dettagli</h2>
          <ReportRenderer blocks={report.body} />
        </div>
      )}

      {/* Rendering della proposta di diff unificata */}
      {report.proposal && <DiffViewer proposal={report.proposal} />}
    </div>
  );
}