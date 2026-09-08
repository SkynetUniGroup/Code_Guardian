import { Router } from './router';

/**
 * Application root component.
 * Renders the TanStack Router provider, which handles all routing, route guards,
 * and the authenticated layout (AppShell). No logic lives here; keep it thin.
 */
function App() {
  return <Router />;
}

export default App;
