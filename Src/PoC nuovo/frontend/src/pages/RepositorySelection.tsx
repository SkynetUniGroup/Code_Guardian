import { Link, useNavigate } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { createContext, createTask, getOperations } from '../utils/api';
import { useAppStore } from '../stores/useAppStore';
import type { OperationCode } from '../types';

export default function RepositorySelection() {
  const navigate = useNavigate();
  const { addContext, addTask, setCurrentTask } = useAppStore();
  const [operations, setOperations] = useState<{ code: OperationCode; name: string }[]>([]);
  const [operationsLoading, setOperationsLoading] = useState(true);
  const [selectedOperation, setSelectedOperation] = useState<OperationCode | ''>('');
  const [loading, setLoading] = useState(false);
  const { formData: storedFormData, setFormData } = useAppStore();

  // Stato locale inizializzato con valori di default o dati salvati
  const [localForm, setLocalForm] = useState({
    repoOwner: 'marcobarba60',
    repoName: 'testrepo1',
    ref: 'main',
    scope: '',
  });

  // Sincronizza con lo store all'avvio
  useEffect(() => {
    if (storedFormData) {
      setLocalForm(storedFormData);
    }
  }, [storedFormData]);

    const loadOperations = async () => {
      setOperationsLoading(true);
      try {
        const ops = await getOperations();
        setOperations(ops);
      } catch (error) {
        console.error('Failed to load operations:', error);
      } finally {
        setOperationsLoading(false);
      }
    };
    
  useEffect(() => {
    loadOperations();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOperation) return;

    setLoading(true);
    try {
      // 1. Mappiamo lo scope del form sui campi attesi dal Backend
      const scopeType = localForm.scope ? 'DIRECTORIES' : 'FULL_REPOSITORY';
      const paths = localForm.scope ? [localForm.scope] : undefined;

      // Crea contesto
      const contextData = await createContext(
        localForm.repoOwner,
        localForm.repoName,
        localForm.ref,
        scopeType,
        paths
      );
      
      // Il backend ritorna { contextId: '...' }
      addContext({
        id: contextData.contextId,
        repoOwner: localForm.repoOwner,
        repoName: localForm.repoName,
        ref: localForm.ref,
        scope: localForm.scope
      });

      // 2. Avvia task
      const taskResponse = await createTask(contextData.contextId, selectedOperation);
      
      // Il backend ritorna { taskIds: ['...'], batchId: '...' }
      const newTaskId = taskResponse.taskIds[0];

      addTask({
        id: newTaskId,
        contextId: contextData.contextId,
        operation: selectedOperation,
        status: 'pending'
      });
      setCurrentTask(newTaskId);

      // Naviga alla pagina della task usando il nuovo ID
      navigate({ to: '/tasks/$taskId', params: { taskId: newTaskId } });
      //navigate({ to: '/tasks' });
    } catch (error: any) {
      console.error('Failed to start task:', error);
      alert(`Errore nell'avvio dell'analisi: ${error.response?.data?.message || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <Link
        to="/tasks"
        className="text-blue-600 hover:text-blue-800 mb-4 inline-block"
      >
        ← Vedi tutti i task
      </Link>
      <h1 className="text-2xl font-bold mb-6">Nuova Analisi</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">Repository Owner</label>
            <input
              type="text"
              value={localForm.repoOwner}onChange={(e) => {
                const newForm = { ...localForm, repoOwner: e.target.value };
                setLocalForm(newForm);
                setFormData(newForm);
              }}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
              placeholder="skynetunigroup"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Repository Name</label>
            <input
              type="text"
              value={localForm.repoName}
              onChange={(e) => {
                const newForm = { ...localForm, repoName: e.target.value };
                setLocalForm(newForm);
                setFormData(newForm);
              }}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
              placeholder="code_guardian"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">Ref</label>
            <input
              type="text"
              value={localForm.ref}
              onChange={(e) => {
                const newForm = { ...localForm, ref: e.target.value };
                setLocalForm(newForm);
                setFormData(newForm);
              }}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
              placeholder="main"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Scope (Opzionale)</label>
            <input
              type="text"
              value={localForm.scope}
              onChange={(e) => {
                const newForm = { ...localForm, scope: e.target.value };
                setLocalForm(newForm);
                setFormData(newForm);
              }}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
              placeholder="es. Src/"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Operazione</label>
          {operationsLoading ? (
            <div className="mt-1 text-gray-500 text-sm">Caricamento operazioni...</div>
          ) : (
            <select
              value={selectedOperation}
              onChange={(e) => setSelectedOperation(e.target.value as OperationCode)}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 bg-white"
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
          className="px-4 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 disabled:bg-blue-300 transition-colors"
        >
          {loading ? 'Avvio in corso...' : 'Avvia Analisi'}
        </button>
      </form>
    </div>
  );
}