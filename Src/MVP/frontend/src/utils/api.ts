import axios from 'axios';
import { OperationCode } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1';

export const api = axios.create({ baseURL: API_BASE });

export const getOperations = async () => {
  const { data } = await api.get('/operations');
  return data;
};

export const createContext = async (repoOwner: string, repoName: string, ref: string, scopeType: string, paths?: string[]) => {
  // Il backend si aspetta scopeType e paths opzionali
  const { data } = await api.post('/contexts', { repoOwner, repoName, ref, scopeType, paths });
  return data;
};

export const createTask = async (contextId: string, operation: OperationCode) => {
  // Il backend accetta task multiple, quindi si aspetta un array "operations"
  const { data } = await api.post('/tasks', { contextId, operations: [operation] });
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

export const silentLoginStub = async () => {
  const { data } = await api.post('/auth/login');
  if (data.accessToken) {
    sessionStorage.setItem('jwt_token', data.accessToken);
  }
  return data;
};

export const saveGithubCredential = async (token: string) => {
  const { data } = await api.post('/credentials', { 
    token, 
    provider: 'GITHUB' 
  });
  return data;
};

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('jwt_token'); // o dal vostro store Zustand
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});