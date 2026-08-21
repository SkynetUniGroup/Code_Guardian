import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAppStore } from '../stores/useAppStore';
import { getReport } from '../utils/api';
import type { ReportStatus } from '../types';
import { silentLoginStub } from '../utils/api';

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
      let socket: Socket | null = null;
      let handleTaskProgress: ((data: TaskProgressData) => void) | null = null;
      let handleTaskUpdated: ((data: TaskUpdatedData) => void) | null = null;
      let handleTaskFailed: ((data: TaskFailedData) => void) | null = null;
      let handleBatchCompleted: ((data: BatchCompletedData) => void) | null = null;

      const initializeSocket = async () => {
        if (!sessionStorage.getItem('jwt_token')) {
          try {
            await silentLoginStub();
          } catch (err) {
            console.error("Errore nel login silenzioso:", err);
            return;
          }
        }

        const token = sessionStorage.getItem('jwt_token');
        socket = io(WS_URL, {
          transports: ['websocket'],
          auth: { token },
          autoConnect: true,
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
        });

        handleTaskProgress = (data: TaskProgressData) => {
          updateTask(data.taskId, { status: 'RUNNING' });
        };

        handleTaskUpdated = async (data: TaskUpdatedData) => {
          updateTask(data.taskId, {
            status: data.status,
            reportId: data.reportId,
          });

          if (data.status === 'COMPLETED' && data.reportId && !reports[data.reportId]) {
            try {
              const report = await getReport(data.reportId);
              addReport(report);
            } catch (error) {
              console.error('Errore nel recupero del report:', error);
            }
          }
        };

        handleTaskFailed = (data: TaskFailedData) => {
          updateTask(data.taskId, { status: 'FAILED' });
          console.error(`Analisi fallita per la task ${data.taskId}:`, data.error.message);
        };

        handleBatchCompleted = (data: BatchCompletedData) => {
          console.log(`Batch ${data.batchId} completato. Successi: ${data.completed}, Falliti/Annullati: ${data.failed}`);
        };

        socket.on('connect', () => setWebSocketConnected(true));
        socket.on('disconnect', () => setWebSocketConnected(false));
        socket.on('task.progress', handleTaskProgress);
        socket.on('task.updated', handleTaskUpdated);
        socket.on('task.failed', handleTaskFailed);
        socket.on('batch.completed', handleBatchCompleted);
      };

      initializeSocket();

      return () => {
        if (socket) {
          socket.off('connect');
          socket.off('disconnect');
          if (handleTaskProgress) socket.off('task.progress', handleTaskProgress);
          if (handleTaskUpdated) socket.off('task.updated', handleTaskUpdated);
          if (handleTaskFailed) socket.off('task.failed', handleTaskFailed);
          if (handleBatchCompleted) socket.off('batch.completed', handleBatchCompleted);
          socket.disconnect();
        }
      };
    }, [addReport, updateTask, setWebSocketConnected, reports]);
};