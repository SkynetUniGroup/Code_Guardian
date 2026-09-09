import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

/**
 * Application entry point.
 * Mounts the React root inside the #root element defined in index.html.
 * StrictMode is enabled to surface potential issues during development.
 */
// biome-ignore lint/style/noNonNullAssertion: #root e' dichiarato in index.html;
// se manca, fallire subito e rumorosamente e' meglio di una pagina bianca.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
