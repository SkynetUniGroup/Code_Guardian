import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { createContext, createTask, getOperations } from '../utils/api';
import { useAppStore } from '../stores/useAppStore';
import type { OperationCode } from '../types';

export default function RepositorySelection() {
  const navigate = useNavigate();
  const { addContext, addTask, setCurrentTask } = useAppStore();
  const [operations, setOperations] = useState<{ code: OperationCode; name: string }[]>([]);
  const [formData, setFormData] = useState({
    repoOwner: '',
    repoName: '',
    ref: 'main',
    scope: '',
  });
  const [selectedOperation, setSelectedOperation] = useState<OperationCode | ''>('');
  const [loading, setLoading] = useState(false);

  const loadOperations = async () => {
    try {
      const ops = await getOperations();
      setOperations(ops);
    } catch (error) {
      console.error('Failed to load operations:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOperation) return;

    setLoading(true);
    try {
      // Crea contesto
      const context = await createContext(
        formData.repoOwner,
        formData.repoName,
        formData.ref,
        formData.scope,
      );
      addContext(context);

      // Avvia task
      const task = await createTask(context.id, selectedOperation);
      addTask(task);
      setCurrentTask(task.id);

      navigate({ to: '/tasks/$taskId', params: { taskId: task.id } });
    } catch (error) {
      console.error('Failed to start task:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Nuova Analisi</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">Repository Owner</label>
            <input
              type="text"
              value={formData.repoOwner}
              onChange={(e) => setFormData({ ...formData, repoOwner: e.target.value })}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
              placeholder="skynetunigroup"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Repository Name</label>
            <input
              type="text"
              value={formData.repoName}
              onChange={(e) => setFormData({ ...formData, repoName: e.target.value })}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
              placeholder="code-guardian"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">Ref</label>
            <input
              type="text"
              value={formData.ref}
              onChange={(e) => setFormData({ ...formData, ref: e.target.value })}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
              placeholder="main"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Scope</label>
            <input
              type="text"
              value={formData.scope}
              onChange={(e) => setFormData({ ...formData, scope: e.target.value })}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
              placeholder="src/"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Operazione</label>
          {operations.length === 0 && (
            <button
              type="button"
              onClick={loadOperations}
              className="mt-1 text-blue-600 hover:text-blue-800"
            >
              Carica operazioni disponibili
            </button>
          )}
          {operations.length > 0 && (
            <select
              value={selectedOperation}
              onChange={(e) => setSelectedOperation(e.target.value as OperationCode)}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
              required
            >
              <option value="">Seleziona un'operazione</option>
              {operations.map((op) => (
                <option key={op.code} value={op.code}>
                  {op.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <button
          type="submit"
          disabled={loading || !selectedOperation}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-blue-300"
        >
          {loading ? 'Avvio in corso...' : 'Avvia Analisi'}
        </button>
      </form>
    </div>
  );
}