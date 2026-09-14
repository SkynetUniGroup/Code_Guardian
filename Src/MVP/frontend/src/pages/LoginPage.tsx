import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { apiClient } from "../api/client";
import { toApiError } from "../api/errors";
import { Spinner } from "../components/shared/Spinner";
import { ValidatedField } from "../components/shared/ValidatedField";
import { useSessionStore } from "../stores/sessionStore";
import type { AuthTokenDto, LoginDto, UserProfileDto } from "../types";

export function LoginPage() {
  const navigate = useNavigate();
  const login = useSessionStore((s) => s.login);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; global?: string }>({});
  const [loading, setLoading] = useState(false);

  function validate(): boolean {
    const next: typeof errors = {};
    if (!email.trim()) next.email = "Enter your email";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = "Invalid email";
    if (!password) next.password = "Enter your password";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handle_submit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setErrors({});
    const dto: LoginDto = { email: email.trim(), password };
    try {
      const tokenResponse = await apiClient.post<AuthTokenDto>("/auth/login", dto);
      const accessToken = tokenResponse.data.accessToken;
      // The Authorization header is set by the interceptor reading the token from
      // store, che pero' viene popolato solo da login() qui sotto: senza
      // the store. Passing the token manually, this GET went out without a header and returned
      // 401 — the login succeeded but the user saw "invalid credentials"
      // corrette".
      const userResponse = await apiClient.get<UserProfileDto>("/auth/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      login(us
erResponse.data, accessToken);
      navigate({ to: "/select" });
    } catch (err: unknown) {
      const { status } = toApiError(err);
      if (status === 401 || status === 403) {
        setErrors({ global: "Incorrect email or password." });
      } else {
        setErrors({ global: "Network error. Try again later." });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-[#cccccc] bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-bold text-[#2a2a2a]">Code Guardian</h1>
        <p className="mb-6 text-sm text-gray-500">Sign in to your account</p>

        {errors.global && (
          <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-[#cc2222]">
            {errors.global}
          </div>
        )}

        <form onSubmit={handle_submit} noValidate className="flex flex-col gap-4">
          <ValidatedField
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setErrors((p) => ({ ...p, email: undefined }));
            }}
            error={errors.email}
          />
          <ValidatedField
            label="Password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setErrors((p) => ({ ...p, password: undefined }));
            }}
            error={errors.password}
          />
          <button
            type="submit"
            disabled={loading}
            className="mt-2 flex items-center justify-center gap-2 rounded bg-[#2a2a2a] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#
111] transition disabled:opacity-60"
          >
            {loading && <Spinner size="sm" className="text-white" />}
            Accedi
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-gray-500">
          Don't have an account?{" "}
          <Link to="/register" className="text-[#2277cc] hover:underline">
            Registrati
          </Link>
        </p>
      </div>
    </div>
  );
}
