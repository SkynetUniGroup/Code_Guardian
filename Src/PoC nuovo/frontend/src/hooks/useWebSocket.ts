import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAppStore } from '../stores/useAppStore';
import { getReport } from '../utils/api';
import type { ReportStatus } from '../types';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3000';

interface TaskProgressData {
  taskId: string;
  progress: number;
}

interface TaskUpdatedData {
  taskId: string;
  status: ReportStatus;
  reportId?: string;
}

interface TaskFailedData {
  taskId: string;
  error: {
    kind: string;
    message: string;
    stage: string;
  };
}

interface BatchCompletedData {
  batchId: string;
  completed: number;
  failed: number;
}

export const useWebSocket = () => {
  const {
    addReport,
    updateTask,
    setWebSocketConnected,
    reports,
  } = useAppStore();

  useEffect(() => {
    const socket: Socket = io(WS_URL, {
      transports: ['websocket'],
      auth: {
        token: localStorage.getItem('jwt_token') 
      },
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    const handleTaskProgress = (data: TaskProgressData) => {
      updateTask(data.taskId, { status: 'pending' });
    };

    const handleTaskUpdated = async (data: TaskUpdatedData) => {
      updateTask(data.taskId, {
        status: data.status,
        reportId: data.reportId,
      });

      if (data.status === 'completed' && data.reportId && !reports[data.reportId]) {
        try {
          const report = await getReport(data.reportId);
          addReport(report);
        } catch (error) {
          console.error('Errore nel recupero del report:', error);
        }
      }
    };

    const handleTaskFailed = (data: TaskFailedData) => {
      updateTask(data.taskId, { status: 'failed' });
      
      // Feedback visivo per l'utente (non blocca le altre task)
      console.error(`Analisi fallita per la task ${data.taskId}:`, data.error.message);
      // alert(`Attenzione: una task ha riportato un errore (${data.error.kind}). Controlla i dettagli.`);
    };

    const handleBatchCompleted = (data: BatchCompletedData) => {
      console.log(`Batch ${data.batchId} completato. Successi: ${data.completed}, Falliti/Annullati: ${data.failed}`);
      // Qui è possibile triggerare logiche aggiuntive di UI, come l'abilitazione di bottoni 
      // o la notifica di "Tutte le analisi concluse".
    };

    socket.on('connect', () => setWebSocketConnected(true));
    socket.on('disconnect', () => setWebSocketConnected(false));
    socket.on('task.progress', handleTaskProgress);
    socket.on('task.updated', handleTaskUpdated);
    
    // Registrazione dei nuovi eventi previsti dalle specifiche
    socket.on('task.failed', handleTaskFailed);
    socket.on('batch.completed', handleBatchCompleted);

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('task.progress', handleTaskProgress);
      socket.off('task.updated', handleTaskUpdated);
      
      // Cleanup dei nuovi eventi
      socket.off('task.failed', handleTaskFailed);
      socket.off('batch.completed', handleBatchCompleted);
      
      socket.disconnect();
    };
  }, [addReport, updateTask, setWebSocketConnected, reports]);
};