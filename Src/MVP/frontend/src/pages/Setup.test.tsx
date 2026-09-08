import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppStore } from '../stores/useAppStore';

const navigateMock = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

const silentLoginStubMock = vi.fn();
const saveGithubCredentialMock = vi.fn();
vi.mock('../utils/api', () => ({
  silentLoginStub: (...args: any[]) => silentLoginStubMock(...args),
  saveGithubCredential: (...args: any[]) => saveGithubCredentialMock(...args),
}));

const { default: Setup } = await import('./Setup');

const initialState = useAppStore.getState();

beforeEach(() => {
  useAppStore.setState(initialState, true);
  sessionStorage.clear();
  navigateMock.mockReset();
  silentLoginStubMock.mockReset().mockResolvedValue({ accessToken: 'jwt-xyz' });
  saveGithubCredentialMock.mockReset();
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('Setup', () => {
  it('esegue il login silenzioso al mount se non c\'e\' un token in sessionStorage', async () => {
    render(<Setup />);
    await waitFor(() => expect(silentLoginStubMock).toHaveBeenCalledTimes(1));
  });

  it('non esegue il login silenzioso se un token e\' gia\' presente', async () => {
    sessionStorage.setItem('jwt_token', 'gia-loggato');
    render(<Setup />);

    await new Promise((r) => setTimeout(r, 0));
    expect(silentLoginStubMock).not.toHaveBeenCalled();
  });

  it('il pulsante di submit e\' disabilitato finche\' il token GitHub e\' vuoto', () => {
    render(<Setup />);
    expect(screen.getByRole('button', { name: /Salva e Inizia/i })).toBeDisabled();
  });

  it('salva il token, marca isConfigured=true e naviga a "/" al submit riuscito', async () => {
    const user = userEvent.setup();
    saveGithubCredentialMock.mockResolvedValueOnce({ saved: true });
    render(<Setup />);

    await user.type(screen.getByPlaceholderText(/ghp_/i), 'ghp_supersegreto');
    await user.click(screen.getByRole('button', { name: /Salva e Inizia/i }));

    await waitFor(() => expect(saveGithubCredentialMock).toHaveBeenCalledWith('ghp_supersegreto'));
    expect(useAppStore.getState().isConfigured).toBe(true);
    expect(navigateMock).toHaveBeenCalledWith({ to: '/' });
  });

  it('con submit forzato a token vuoto (guardia difensiva) non chiama il backend', async () => {
    // Il pulsante e' disabilitato senza token, ma l'handler ha comunque una
    // guardia esplicita `if (!githubToken) return;`: la verifichiamo
    // inviando il submit dell'form direttamente, scenario limite realistico
    // (es. submit via tasto Invio prima che React aggiorni lo stato).
    const { container } = render(<Setup />);

    fireEvent.submit(container.querySelector('form')!);

    await new Promise((r) => setTimeout(r, 0));
    expect(saveGithubCredentialMock).not.toHaveBeenCalled();
  });

  it('mostra un alert e NON naviga se il salvataggio della credenziale fallisce', async () => {
    const user = userEvent.setup();
    saveGithubCredentialMock.mockRejectedValueOnce(new Error('token non valido'));
    render(<Setup />);

    await user.type(screen.getByPlaceholderText(/ghp_/i), 'ghp_rotto');
    await user.click(screen.getByRole('button', { name: /Salva e Inizia/i }));

    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(navigateMock).not.toHaveBeenCalled();
    expect(useAppStore.getState().isConfigured).toBe(false);
  });
});
