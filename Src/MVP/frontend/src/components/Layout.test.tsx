import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAppStore } from '../stores/useAppStore';

const navigateMock = vi.fn();
let currentPathname = '/';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  useRouterState: () => ({ location: { pathname: currentPathname } }),
  Outlet: () => <div data-testid="outlet-content">contenuto pagina</div>,
  Link: ({ to, children }: any) => <a href={to}>{children}</a>,
}));

// useWebSocket apre una vera connessione socket.io: la isoliamo per
// concentrare il test sulla sola logica di guardia/redirect di Layout.
const useWebSocketMock = vi.fn();
vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: () => useWebSocketMock(),
}));

const { default: Layout } = await import('./Layout');

const initialState = useAppStore.getState();

beforeEach(() => {
  useAppStore.setState(initialState, true);
  navigateMock.mockReset();
  useWebSocketMock.mockReset();
  currentPathname = '/';
});

describe('Layout', () => {
  it('reindirizza a /setup se l\'utente non e\' configurato e non e\' gia\' su /setup', () => {
    useAppStore.getState().setConfigured(false);
    currentPathname = '/';

    render(<Layout />);

    expect(navigateMock).toHaveBeenCalledWith({ to: '/setup' });
  });

  it('non reindirizza se l\'utente non e\' configurato ma si trova gia\' su /setup', () => {
    useAppStore.getState().setConfigured(false);
    currentPathname = '/setup';

    render(<Layout />);

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('non reindirizza quando l\'utente e\' gia\' configurato', () => {
    useAppStore.getState().setConfigured(true);
    currentPathname = '/';

    render(<Layout />);

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('quando non configurato renderizza solo il contenuto della pagina, senza header di navigazione', () => {
    useAppStore.getState().setConfigured(false);
    currentPathname = '/setup';

    render(<Layout />);

    expect(screen.getByTestId('outlet-content')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
  });

  it('quando configurato renderizza l\'header di navigazione insieme al contenuto', () => {
    useAppStore.getState().setConfigured(true);

    render(<Layout />);

    expect(screen.getByTestId('outlet-content')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
  });

  it('attiva sempre la connessione websocket, indipendentemente dallo stato di configurazione', () => {
    useAppStore.getState().setConfigured(false);
    render(<Layout />);
    expect(useWebSocketMock).toHaveBeenCalledTimes(1);
  });
});
