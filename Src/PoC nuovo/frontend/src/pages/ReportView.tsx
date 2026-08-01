import { useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { getReport } from '../utils/api';
import { useAppStore } from '../stores/useAppStore';
import ReportRenderer from '../components/ReportRenderer';
import type { Report } from '../types';

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
    return <div className="p-4">Caricamento report...</div>;
  }

  if (!report) {
    return <div className="p-4">Report non trovato</div>;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Report: {report.operation}</h1>
        <span className="px-3 py-1 rounded-full text-sm bg-gray-100">
          {report.status}
        </span>
      </div>

      {report.summary && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <h2 className="font-medium mb-2">Riassunto</h2>
          <p>{report.summary}</p>
        </div>
      )}

      {report.error && (
        <div className="mb-6 p-4 bg-red-50 rounded-lg">
          <h2 className="font-medium mb-2 text-red-800">Errore</h2>
          <p className="text-red-700">{report.error.message}</p>
        </div>
      )}

      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-medium mb-4">Dettagli</h2>
        <ReportRenderer blocks={report.body} />
      </div>

      {report.proposal && (
        <div className="mt-6 bg-blue-50 rounded-lg p-6">
          <h2 className="text-lg font-medium mb-4">Proposta</h2>
          <pre className="text-sm overflow-x-auto">
            {JSON.stringify(report.proposal, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}