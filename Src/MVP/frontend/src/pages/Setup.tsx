import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAppStore } from "../stores/useAppStore";
import { saveGithubCredential, silentLoginStub } from "../utils/api";

export default function Setup() {
  const [githubToken, setGithubToken] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setConfigured } = useAppStore();

  useEffect(() => {
    // Perform silent stub login as soon as the app opens
    if (!sessionStorage.getItem("jwt_token")) {
      silentLoginStub().catch((err) => console.error("Error in login stub:", err));
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!githubToken) return;

    setLoading(true);
    try {
      // Save the encrypted credential to the backend
      await saveGithubCredential(githubToken);

      // Update the store and go to home
      setConfigured(true);
      navigate({ to: "/" });
    } catch (error) {
      console.error("Error saving token:", error);
      alert("Error saving token. Check the console.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-20 p-6 bg-white rounded-lg shadow-md">
      <h1 className="text-2xl font-bold mb-2">Initial Setup</h1>
      <p className="text-gray-500 mb-6">
        For the PoC, authentication is simulated. Enter your GitHub Personal Access Token
        to allow agents to analyze code.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="github-pat" className="block text-sm font-medium text-gray-700">
            GitHub PAT (Read-only)
          </label>
          <input
            id="github-pat"
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
          {loading ? "Saving..." : "Save and Start"}
        </button>
      </form>
    </div>
  );
}
