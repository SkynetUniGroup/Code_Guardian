import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { silentLoginStub, saveGithubCredential } from '../utils/api';
import { useAppStore } from '../stores/useAppStore';

export default function Setup() {
  const [githubToken, setGithubToken] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setConfigured } = useAppStore();

  useEffect(() => {
    // Effettua il login silenzioso dello stub non appena si apre l'app
    if (!sessionStorage.getItem('jwt_token')) {
      silentLoginStub().catch(err => console.error("Errore nello stub di login:", err));
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!githubToken) return;

    setLoading(true);
    try {
      // Salva la credenziale cifrata sul backend
      await saveGithubCredential(githubToken);
      
      // Aggiorna lo store e vai alla home
      setConfigured(true);
      navigate({ to: '/' });
    } catch (error) {
      console.error('Errore durante il salvataggio del token:', error);
      alert("Errore nel salvataggio del token. Controlla la console.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-20 p-6 bg-white rounded-lg shadow-md">
      <h1 className="text-2xl font-bold mb-2">Configurazione Iniziale</h1>
      <p className="text-gray-500 mb-6">
        Per il PoC, l'autenticazione è simulata. Inserisci il tuo Personal Access Token di GitHub per permettere agli agenti l'analisi del codice.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">GitHub PAT (Sola lettura)</label>
          <input
            type="password"
            value={githubToken}
            onChange={(e) => setGithubToken(e.target.value)}
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
            placeholder="ghp_xxxxxxxxxxxx..."
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading || !githubToken}
          className="w-full px-4 py-2 bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:bg-gray-400"
        >
          {loading ? 'Salvataggio...' : 'Salva e Inizia'}
        </button>
      </form>
    </div>
  );
}