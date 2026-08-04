import { useAppStore } from '../stores/useAppStore';
import { useNavigate, Link } from '@tanstack/react-router';

export default function TasksList() {
  const { tasks, reports } = useAppStore();
  const navigate = useNavigate();

  const getStatusColor = (status: string) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-800',
      running: 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const groupedTasks = {
    inProgress: tasks.filter(t => t.status === 'pending' || t.status === 'RUNNING'),
    completed: tasks.filter(t => t.status === 'COMPLETED'),
    failed: tasks.filter(t => t.status === 'FAILED'),
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Elenco Task</h1>
        <Link
          to="/"
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        >
          Nuova Analisi
        </Link>
      </div>

      {Object.entries(groupedTasks).map(([group, groupTasks]) => (
        groupTasks.length > 0 && (
          <div key={group} className="mb-8">
            <h2 className="text-xl font-semibold mb-4 capitalize">
              {group === 'inProgress' ? 'In corso' : group}
            </h2>
            <div className="space-y-3">
              {groupTasks.map((task) => (
                <div
                  key={task.id}
                  className="border rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium">{task.operation}</span>
                        <span
                          className={`px-2 py-1 rounded-full text-xs ${getStatusColor(task.status)}`}
                        >
                          {task.status}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600">
                        ID: {task.id.substring(0, 8)}...
                      </div>
                      {task.contextId && (
                        <div className="text-sm text-gray-500 mt-1">
                          Contesto: {task.contextId.substring(0, 8)}...
                        </div>
                      )}
                    </div>
                    {task.reportId && reports[task.reportId] && (
                      <Link
                        to="/reports/$reportId"
                        params={{ reportId: task.reportId }}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                      >
                        Vedi Report →
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      ))}

      {tasks.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          Nessun task trovato. <Link to="/" className="text-blue-600 hover:underline">Avvia una nuova analisi</Link>
        </div>
      )}
    </div>
  );
}