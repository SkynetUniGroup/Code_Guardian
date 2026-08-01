import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const api = axios.create({ baseURL: API_BASE });

export const getOperations = async () => {
  const { data } = await api.get('/operations');
  return data;
};

export const createContext = async (repoOwner: string, repoName: string, ref: string, scope: string) => {
  const { data } = await api.post('/contexts', { repoOwner, repoName, ref, scope });
  return data;
};

export const createTask = async (contextId: string, operation: OperationCode) => {
  const { data } = await api.post('/tasks', { contextId, operation });
  return data;
};

export const getTask = async (taskId: string) => {
  const { data } = await api.get(`/tasks/${taskId}`);
  return data;
};

export const getReport = async (reportId: string) => {
  const { data } = await api.get(`/reports/${reportId}`);
  return data;
};