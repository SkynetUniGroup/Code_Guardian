import { describe, it, expect, vi, beforeEach } from 'vitest';

// Cattura la callback registrata da `api.interceptors.request.use(...)` cosi'
// da poterla invocare direttamente nei test, senza dover eseguire una vera
// richiesta HTTP.
let requestInterceptor: (config: any) => any;

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: mockGet,
      post: mockPost,
      interceptors: {
        request: {
          use: (fn: (config: any) => any) => {
            requestInterceptor = fn;
          },
        },
      },
    })),
  },
}));

// Import dinamico DOPO il mock, cosi' il modulo sotto test costruisce la sua
// istanza axios usando lo stub sopra invece del client HTTP reale.
const {
  getOperations,
  createContext,
  createTask,
  getTask,
  getReport,
  silentLoginStub,
  saveGithubCredential,
} = await import('./api');

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  sessionStorage.clear();
});

describe('api - funzioni di chiamata al backend', () => {
  it('getOperations chiama GET /operations e restituisce il payload', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ code: 'SECURITY_OWASP', name: 'Scansione OWASP' }] });

    const result = await getOperations();

    expect(mockGet).toHaveBeenCalledWith('/operations');
    expect(result).toEqual([{ code: 'SECURITY_OWASP', name: 'Scansione OWASP' }]);
  });

  it('createContext invia repoOwner/repoName/ref/scopeType/paths a POST /contexts', async () => {
    mockPost.mockResolvedValueOnce({ data: { contextId: 'ctx-1' } });

    const result = await createContext('skynet', 'code_guardian', 'main', 'DIRECTORIES', ['src/']);

    expect(mockPost).toHaveBeenCalledWith('/contexts', {
      repoOwner: 'skynet',
      repoName: 'code_guardian',
      ref: 'main',
      scopeType: 'DIRECTORIES',
      paths: ['src/'],
    });
    expect(result).toEqual({ contextId: 'ctx-1' });
  });

  it('createContext funziona anche senza paths (ambito intero repository)', async () => {
    mockPost.mockResolvedValueOnce({ data: { contextId: 'ctx-2' } });

    await createContext('skynet', 'code_guardian', 'main', 'FULL_REPOSITORY');

    expect(mockPost).toHaveBeenCalledWith('/contexts', {
      repoOwner: 'skynet',
      repoName: 'code_guardian',
      ref: 'main',
      scopeType: 'FULL_REPOSITORY',
      paths: undefined,
    });
  });

  it('createTask avvolge la singola operazione in un array "operations"', async () => {
    mockPost.mockResolvedValueOnce({ data: { taskIds: ['task-1'], batchId: 'batch-1' } });

    const result = await createTask('ctx-1', 'SECURITY_OWASP');

    expect(mockPost).toHaveBeenCalledWith('/tasks', { contextId: 'ctx-1', operations: ['SECURITY_OWASP'] });
    expect(result.taskIds).toEqual(['task-1']);
  });

  it('getTask chiama GET /tasks/:id con l\'id corretto', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 'task-1', status: 'RUNNING' } });

    const result = await getTask('task-1');

    expect(mockGet).toHaveBeenCalledWith('/tasks/task-1');
    expect(result.status).toBe('RUNNING');
  });

  it('getReport chiama GET /reports/:id con l\'id corretto', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 'report-1', status: 'COMPLETED' } });

    const result = await getReport('report-1');

    expect(mockGet).toHaveBeenCalledWith('/reports/report-1');
    expect(result.status).toBe('COMPLETED');
  });

  it('saveGithubCredential invia il token con provider fisso "GITHUB"', async () => {
    mockPost.mockResolvedValueOnce({ data: { saved: true } });

    await saveGithubCredential('ghp_abc123');

    expect(mockPost).toHaveBeenCalledWith('/credentials', { token: 'ghp_abc123', provider: 'GITHUB' });
  });

  describe('silentLoginStub', () => {
    it('memorizza accessToken in sessionStorage quando presente nella risposta', async () => {
      mockPost.mockResolvedValueOnce({ data: { accessToken: 'jwt-xyz' } });

      await silentLoginStub();

      expect(sessionStorage.getItem('jwt_token')).toBe('jwt-xyz');
    });

    it('non scrive nulla in sessionStorage se la risposta e\' priva di accessToken', async () => {
      mockPost.mockResolvedValueOnce({ data: {} });

      await silentLoginStub();

      expect(sessionStorage.getItem('jwt_token')).toBeNull();
    });

    it('propaga l\'errore se la chiamata di login fallisce', async () => {
      mockPost.mockRejectedValueOnce(new Error('network down'));

      await expect(silentLoginStub()).rejects.toThrow('network down');
    });
  });

  describe('interceptor di autenticazione', () => {
    it('aggiunge l\'header Authorization quando un token e\' presente in sessionStorage', () => {
      sessionStorage.setItem('jwt_token', 'jwt-xyz');

      const config = requestInterceptor({ headers: {} as any });

      expect(config.headers.Authorization).toBe('Bearer jwt-xyz');
    });

    it('non imposta l\'header Authorization se non c\'e\' alcun token salvato', () => {
      const config = requestInterceptor({ headers: {} as any });

      expect(config.headers.Authorization).toBeUndefined();
    });
  });
});
