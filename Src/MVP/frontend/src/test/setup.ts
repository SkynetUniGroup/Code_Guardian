import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Smonta i componenti renderizzati e pulisce sessionStorage dopo ogni test,
// cosi' che lo stato (es. jwt_token) non trapeli da un test al successivo.
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});
