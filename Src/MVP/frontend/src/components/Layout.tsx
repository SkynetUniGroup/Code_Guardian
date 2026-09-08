import { Outlet, Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAppStore } from '../stores/useAppStore';

export default function Layout() {
  useWebSocket();
  const navigate = useNavigate();
  const routerState = useRouterState();
  const { isConfigured } = useAppStore();

  useEffect(() => {
    if (!isConfigured && routerState.location.pathname !== '/setup') {
      navigate({ to: '/setup' });
    }
  }, [isConfigured, routerState.location.pathname, navigate]);


  if (!isConfigured) {
    return (
      <div className="min-h-screen bg-gray-50">
        <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ... (mantieni il tuo Header/Nav attuale) ... */}
      <header className="bg-white shadow">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <Link to="/" className="px-3 py-2 text-sm font-medium text-gray-700 hover:text-blue-600">
                Home
              </Link>
            </div>
          </div>
        </nav>
      </header>
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}