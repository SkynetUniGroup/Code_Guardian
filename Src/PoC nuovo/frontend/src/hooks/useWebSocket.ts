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
          console.error('Failed to fetch report:', error);
        }
      }
    };

    socket.on('connect', () => setWebSocketConnected(true));
    socket.on('disconnect', () => setWebSocketConnected(false));
    socket.on('task.progress', handleTaskProgress);
    socket.on('task.updated', handleTaskUpdated);

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('task.progress', handleTaskProgress);
      socket.off('task.updated', handleTaskUpdated);
      socket.disconnect();
    };
  }, [addReport, updateTask, setWebSocketConnected, reports]);
};