import { useParams, Link } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useAppStore } from '../stores/useAppStore';

export default function TaskExecution() {
  const { taskId } = useParams({ strict: false }) as { taskId: string };
  const { tasks, reports, setCurrentTask } = useAppStore();

  const task = tasks.find((t) => t.id === taskId);
  const report = task?.reportId ? reports[task.reportId] : null;

  useEffect(() => {
    if (taskId) {
      setCurrentTask(taskId);
    }
  }, [taskId, setCurrentTask]);

  if (!task) {
    return <div className="p-4">Task non trovata</div>;
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Esecuzione Task</h1>

      <div className="bg-white shadow rounded-lg p-6">
        <div className="mb-4">
          <h2 className="text-lg font-medium">Stato: {task.status}</h2>

          {/* Aggiornato in maiuscolo per PENDING e RUNNING */}
          {(task.status === 'PENDING' || task.status === 'RUNNING') && (
            <div className="mt-2">
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div className="bg-blue-600 h-2.5 rounded-full animate-pulse"></div>
              </div>
              <p className="text-sm text-gray-500 mt-1">Analisi in corso...</p>
            </div>
          )}

          {/* Aggiornato in maiuscolo per COMPLETED */}
          {task.status === 'COMPLETED' && task.reportId && (
            <div className="mt-4 p-4 bg-green-50 rounded-lg">
              <p className="text-green-800">Analisi completata!</p>
              <Link
                to="/reports/$reportId"
                params={{ reportId: task.reportId }}
                className="mt-2 inline-block text-blue-600 hover:text-blue-800 font-medium"
              >
                Visualizza Report →
              </Link>
            </div>
          )}

          {/* Aggiornato in maiuscolo per FAILED */}
          {task.status === 'FAILED' && (
            <div className="mt-4 p-4 bg-red-50 rounded-lg">
              <p className="text-red-800">Analisi fallita</p>
              <Link to="/" className="mt-2 inline-block text-blue-600 hover:text-blue-800">
                ← Torna alla selezione
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}