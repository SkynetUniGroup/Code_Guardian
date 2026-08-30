import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppStore } from '../stores/useAppStore';

const navigateMock = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

const getOperationsMock = vi.fn();
const createContextMock = vi.fn();
const createTaskMock = vi.fn();
vi.mock('../utils/api', () => ({
  getOperations: (...args: any[]) => getOperationsMock(...args),
  createContext: (...args: any[]) => createContextMock(...args),
  createTask: (...args: any[]) => createTaskMock(...args),
}));

const { default: RepositorySelection } = await import('./RepositorySelection');

const initialState = useAppStore.getState();

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText('skynetunigroup'), 'skynet');
  await user.type(screen.getByPlaceholderText('code_guardian'), 'code_guardian');
  // "Ref" ha gia' un valore di default ('main'), niente da digitare.
  await user.click(screen.getByRole('button', { name: /Carica operazioni disponibili/i }));
  await screen.findByRole('combobox');
  await user.selectOptions(screen.getByRole('combobox'), 'SECURITY_OWASP');
}

beforeEach(() => {
  useAppStore.setState(initialState, true);
  navigateMock.mockReset();
  getOperationsMock.mockReset().mockResolvedValue([{ code: 'SECURITY_OWASP', name: 'Scansione OWASP' }]);
  createContextMock.mockReset();
  createTaskMock.mockReset();
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('RepositorySelection', () => {
  it('precompila il form con i dati salvati nello store (persistenza tra navigazioni)', () => {
    useAppStore.getState().setFormData({ repoOwner: 'skynet', repoName: 'code_guardian', ref: 'develop', scope: 'src/' });

    render(<RepositorySelection />);

    expect(screen.getByPlaceholderText('skynetunigroup')).toHaveValue('skynet');
    expect(screen.getByPlaceholderText('code_guardian')).toHaveValue('code_guardian');
    expect(screen.getByPlaceholderText('main')).toHaveValue('develop');
    expect(screen.getByPlaceholderText(/Src\//)).toHaveValue('src/');
  });

  it('ogni digitazione nei campi aggiorna anche il formData persistito nello store', async () => {
    const user = userEvent.setup();
    render(<RepositorySelection />);

    await user.type(screen.getByPlaceholderText('skynetunigroup'), 'skynet');

    expect(useAppStore.getState().formData?.repoOwner).toBe('skynet');
  });

  it('con submit forzato senza operazione selezionata (guardia difensiva) non contatta il backend', async () => {
    // Come per Setup: il pulsante e' disabilitato senza selectedOperation,
    // ma la guardia esplicita nell'handler viene comunque verificata
    // inviando il submit dell'form direttamente.
    const { container } = render(<RepositorySelection />);

    fireEvent.submit(container.querySelector('form')!);

    await new Promise((r) => setTimeout(r, 0));
    expect(createContextMock).not.toHaveBeenCalled();
  });

  it('mostra il pulsante "Carica operazioni" finche\' la select non e\' stata popolata', () => {
    render(<RepositorySelection />);
    expect(screen.getByRole('button', { name: /Carica operazioni disponibili/i })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('un fallimento nel caricamento delle operazioni viene loggato e non fa crashare la pagina', async () => {
    const user = userEvent.setup();
    getOperationsMock.mockRejectedValueOnce(new Error('backend irraggiungibile'));
    render(<RepositorySelection />);

    await user.click(screen.getByRole('button', { name: /Carica operazioni disponibili/i }));

    await waitFor(() => expect(console.error).toHaveBeenCalledWith('Failed to load operations:', expect.any(Error)));
    // Il pulsante resta visibile: la select non e' mai stata popolata.
    expect(screen.getByRole('button', { name: /Carica operazioni disponibili/i })).toBeInTheDocument();
  });

  it('la modifica del campo "Ref" aggiorna sia lo stato locale che il formData nello store', async () => {
    const user = userEvent.setup();
    render(<RepositorySelection />);

    const refInput = screen.getByPlaceholderText('main');
    await user.clear(refInput);
    await user.type(refInput, 'develop');

    expect(refInput).toHaveValue('develop');
    expect(useAppStore.getState().formData?.ref).toBe('develop');
  });

  it('al click carica le operazioni e le rende disponibili nella select', async () => {
    const user = userEvent.setup();
    render(<RepositorySelection />);

    await user.click(screen.getByRole('button', { name: /Carica operazioni disponibili/i }));

    expect(await screen.findByRole('option', { name: 'Scansione OWASP' })).toBeInTheDocument();
  });

  it('con scope vuoto invia scopeType FULL_REPOSITORY e paths undefined', async () => {
    const user = userEvent.setup();
    createContextMock.mockResolvedValueOnce({ contextId: 'ctx-1' });
    createTaskMock.mockResolvedValueOnce({ taskIds: ['task-1'], batchId: 'batch-1' });
    render(<RepositorySelection />);

    await fillRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /Avvia Analisi/i }));

    await waitFor(() => expect(createContextMock).toHaveBeenCalledWith('skynet', 'code_guardian', 'main', 'FULL_REPOSITORY', undefined));
  });

  it('con uno scope valorizzato invia scopeType DIRECTORIES e paths=[scope]', async () => {
    const user = userEvent.setup();
    createContextMock.mockResolvedValueOnce({ contextId: 'ctx-1' });
    createTaskMock.mockResolvedValueOnce({ taskIds: ['task-1'], batchId: 'batch-1' });
    render(<RepositorySelection />);

    await user.type(screen.getByPlaceholderText(/Src\//), 'src/');
    await fillRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /Avvia Analisi/i }));

    await waitFor(() => expect(createContextMock).toHaveBeenCalledWith('skynet', 'code_guardian', 'main', 'DIRECTORIES', ['src/']));
  });

  it('REGRESSIONE: la task appena creata ha status "PENDING" (maiuscolo), coerente con ReportStatus', async () => {
    // Bug reale trovato scrivendo questo test: il componente scriveva
    // status: 'pending' (minuscolo), che non combacia con nessuno dei
    // controlli in TaskExecution.tsx (tutti in maiuscolo) ne' col tipo
    // ReportStatus. L'effetto era che, subito dopo l'avvio di un'analisi,
    // la pagina di esecuzione non mostrava la barra di progresso finche'
    // non arrivava il primo evento websocket a sovrascrivere lo stato.
    const user = userEvent.setup();
    createContextMock.mockResolvedValueOnce({ contextId: 'ctx-1' });
    createTaskMock.mockResolvedValueOnce({ taskIds: ['task-99'], batchId: 'batch-1' });
    render(<RepositorySelection />);

    await fillRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /Avvia Analisi/i }));

    await waitFor(() => expect(useAppStore.getState().tasks).toHaveLength(1));
    expect(useAppStore.getState().tasks[0].status).toBe('PENDING');
  });

  it('al successo aggiorna lo store (context, task, currentTask) e naviga alla task creata', async () => {
    const user = userEvent.setup();
    createContextMock.mockResolvedValueOnce({ contextId: 'ctx-1' });
    createTaskMock.mockResolvedValueOnce({ taskIds: ['task-99'], batchId: 'batch-1' });
    render(<RepositorySelection />);

    await fillRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /Avvia Analisi/i }));

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/tasks/$taskId', params: { taskId: 'task-99' } }));
    expect(useAppStore.getState().contexts).toHaveLength(1);
    expect(useAppStore.getState().tasks).toHaveLength(1);
    expect(useAppStore.getState().currentTaskId).toBe('task-99');
  });

  it('in caso di errore con messaggio dal backend lo mostra in alert e non naviga', async () => {
    const user = userEvent.setup();
    createContextMock.mockRejectedValueOnce({ response: { data: { message: 'Repository non raggiungibile' } } });
    render(<RepositorySelection />);

    await fillRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /Avvia Analisi/i }));

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Repository non raggiungibile')));
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('in caso di errore senza risposta strutturata dal backend usa error.message come fallback', async () => {
    const user = userEvent.setup();
    createContextMock.mockRejectedValueOnce(new Error('Network Error'));
    render(<RepositorySelection />);

    await fillRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /Avvia Analisi/i }));

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Network Error')));
  });
});
