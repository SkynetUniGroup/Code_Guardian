import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

/**
 * Application entry point.
 * Mounts the React root inside the #root element defined in index.html.
 * StrictMode is enabled to surface potential issues during development.
 */
// biome-ignore lint/style/noNonNullAssertion: #root is declared in index.html;
// if it is missing, failing immediately and loudly is better than a blank page.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
