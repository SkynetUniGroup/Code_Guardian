import { AxiosError } from "axios";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSelectionStore } from "../stores/selectionStore";
import { useSessionStore } from "../stores/sessionStore";
import type { UserRole } from "../types";

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

const postMock = vi.fn();
const getMock = vi.fn();
vi.mock("../api/client", () => ({
  apiClient: {
    get: (...args: any[]) => getMock(...args),
    post: (...args: any[]) => postMock(...args),
  },
}));

const { RunPage } = await import("./RunPage");

const initialSession = useSessionStore.getState();
const initialSelection = useSelectionStore.getState();

const CONTESTO = {
  id: "ctx-1",
  repoOwner: "OWASP",
  repoName: "NodeGoat",
  isPrivate: true,
  branch: "main",
  resolvedSha: "abc1234567890",
  scopeType: "FULL_REPOSITORY" as const,
  detectedLanguages: ["JavaScript"],
  unsupportedLanguages: [],
  predominantLanguage: "JavaScript",
  unsupportedLanguageWarning: false,
  estimatedFileCount: 42,
  nonEnglishReadmeDetected: false,
};

function httpError(status: number, message?: string) {
  // Dev'essere un AxiosError vero: toApiError legge stato e corpo solo dopo
  // `err instanceof AxiosError`, e con un oggetto della sola forma giusta la
  // pagina non vedrebbe nemmeno lo stato.
  return new AxiosError(
    message ?? "Request failed",
    String(status),
    undefined,
    undefined,
    { status, data: message ? { message } : {}, statusText: "", headers: {}, config: {} } as never,
  );
}

// Le operazioni non sono piu' cablate nella pagina: RunPage le legge da
// GET /operations, e il backend le filtra per ruolo. Il mock riproduce
// quel filtro, con gli stessi codici del registro in agent-registry.service.ts.
const DESCRITTORI = {
  DOCS_README: { agent: "DOCS", description: "Genera o aggiorna il README." },
  DOCS_INLINE: { agent: "DOCS", description: "Documenta il codice riga per riga." },
  DOCS_API: { agent: "DOCS", description: "Documenta gli endpoint esposti." },
  SECURITY_OWASP: { agent: "SECURITY", description: "Cerca le vulnerabilita' OWASP Top 10." },
  SECURITY_POLICY: { agent: "SECURITY", description: "Verifica le regole del POLICY.md." },
  CHANGELOG_TECHNICAL: { agent: "CHANGELOG", description: "Changelog per chi sviluppa." },
  CHANGELOG_BUSINESS: { agent: "CHANGELOG", description: "Note di rilascio per il committente." },
} as const;

const PER_RUOLO: Record<UserRole, (keyof typeof DESCRITTORI)[]> = {
  DEVELOPER: ["DOCS_README", "DOCS_INLINE", "DOCS_API", "CHANGELOG_TECHNICAL"],
  SECURITY_AUDITOR: ["SECURITY_OWASP", "SECURITY_POLICY"],
  PROJECT_MANAGER: ["CHANGELOG_TECHNICAL", "CHANGELOG_BUSINESS"],
};

function operazioniDi(role: UserRole) {
  return PER_RUOLO[role].map((code) => ({
    code,
    // Il backend li manda in inglese; la pagina rende l'etichetta italiana.
    displayName: code,
    ...DESCRITTORI[code],
  }));
}

/** Prepara sessione e contesto, poi monta la pagina. */
async function renderConContesto(role: UserRole = "SECURITY_AUDITOR") {
  getMock.mockResolvedValue({ data: operazioniDi(role) });
  useSessionStore.setState({ user: { id: "u1", firstName: "Ada", role }, token: "jwt" });
  useSelectionStore.getState().setContext(CONTESTO);
  render(<RunPage />);
  // Le operazioni arrivano da GET /operations: prima che la risposta atterri
  // la pagina non ha ancora alcuna scheda da mostrare.
  await screen.findByRole("button", { name: new RegExp(PRIMA_ETICHETTA[role]) });
  return userEvent.setup();
}

const PRIMA_ETICHETTA: Record<UserRole, string> = {
  DEVELOPER: "Documentazione README",
  SECURITY_AUDITOR: "Analisi Sicurezza OWASP",
  PROJECT_MANAGER: "Changelog Tecnico",
};

beforeEach(() => {
  useSessionStore.setState(initialSession, true);
  useSelectionStore.setState(initialSelection, true);
  navigateMock.mockReset();
  postMock.mockReset();
  getMock.mockReset();
  getMock.mockResolvedValue({ data: [] });
});

describe("RunPage", () => {
  it("senza un contesto configurato non mostra operazioni ma rimanda alla selezione", async () => {
    useSessionStore.setState({ user: { id: "u1", firstName: "Ada", role: "DEVELOPER" } });
    render(<RunPage />);
    const user = userEvent.setup();

    expect(screen.getByText(/Nessun contesto configurato/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Analisi Sicurezza/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Vai a Repository" }));
    expect(navigateMock).toHaveBeenCalledWith({ to: "/select" });
  });

  it("riepiloga il contesto attivo: repository, SHA abbreviato, ambito e linguaggi", async () => {
    await renderConContesto();

    expect(screen.getByText("OWASP/NodeGoat")).toBeInTheDocument();
    expect(screen.getByText("abc12345")).toBeInTheDocument();
    expect(screen.getByText(/FULL_REPOSITORY/)).toBeInTheDocument();
    expect(screen.getByText(/JavaScript/)).toBeInTheDocument();
    expect(screen.getByText(/42 file stimati/)).toBeInTheDocument();
  });

  it("elenca le sole operazioni permesse al ruolo Security Auditor", async () => {
    await renderConContesto("SECURITY_AUDITOR");

    expect(screen.getByRole("button", { name: /Analisi Sicurezza OWASP/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Verifica Policy/ })).toBeInTheDocument();
    // Le operazioni di documentazione appartengono al ruolo Developer.
    expect(screen.queryByRole("button", { name: /Documentazione README/ })).not.toBeInTheDocument();
  });

  it("elenca le quattro operazioni del ruolo Developer", async () => {
    await renderConContesto("DEVELOPER");

    for (const etichetta of [
      /Documentazione README/,
      /Documentazione Inline/,
      /Documentazione API/,
      /Changelog Tecnico/,
    ]) {
      expect(screen.getByRole("button", { name: etichetta })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /Analisi Sicurezza/ })).not.toBeInTheDocument();
  });

  it("elenca le due operazioni del ruolo Project Manager", async () => {
    await renderConContesto("PROJECT_MANAGER");

    expect(screen.getByRole("button", { name: /Changelog Tecnico/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Changelog Business/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Verifica Policy/ })).not.toBeInTheDocument();
  });

  it("selezionare e deselezionare la stessa operazione la riporta allo stato iniziale", async () => {
    const user = await renderConContesto();
    const carta = screen.getByRole("button", { name: /Analisi Sicurezza OWASP/ });
    expect(carta).toHaveAttribute("aria-pressed", "false");

    await user.click(carta);
    expect(carta).toHaveAttribute("aria-pressed", "true");

    await user.click(carta);
    expect(carta).toHaveAttribute("aria-pressed", "false");
  });

  it("permette di selezionare piu' operazioni contemporaneamente", async () => {
    const user = await renderConContesto();

    await user.click(screen.getByRole("button", { name: /Analisi Sicurezza OWASP/ }));
    await user.click(screen.getByRole("button", { name: /Verifica Policy/ }));

    expect(screen.getByRole("button", { name: /Analisi Sicurezza OWASP/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /Verifica Policy/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Avvia 2 operazioni" })).toBeInTheDocument();
  });

  it("senza alcuna operazione selezionata il pulsante di avvio e' inerte", async () => {
    const user = await renderConContesto();
    const avvio = screen.getByRole("button", { name: /Seleziona almeno un'operazione/ });

    expect(avvio).toBeDisabled();
    await user.click(avvio);

    expect(postMock).not.toHaveBeenCalled();
  });

  it("avvia le operazioni selezionate sul contesto corrente e passa al monitoraggio", async () => {
    const user = await renderConContesto();
    postMock.mockResolvedValueOnce({ data: {} });
    await user.click(screen.getByRole("button", { name: /Analisi Sicurezza OWASP/ }));
    await user.click(screen.getByRole("button", { name: /Verifica Policy/ }));

    await user.click(screen.getByRole("button", { name: "Avvia 2 operazioni" }));

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/tasks" }));
    expect(postMock).toHaveBeenCalledWith("/tasks", {
      contextId: "ctx-1",
      operations: ["SECURITY_OWASP", "SECURITY_POLICY"],
    });
  });

  it("con una sola operazione il pulsante lo dice al singolare", async () => {
    const user = await renderConContesto();

    await user.click(screen.getByRole("button", { name: /Analisi Sicurezza OWASP/ }));

    expect(screen.getByRole("button", { name: "Avvia operazione" })).toBeInTheDocument();
  });

  it("al superamento del limite di utilizzo (429) lo dichiara e non naviga", async () => {
    // RF.66: il backend risponde 429, non 402. Il messaggio mostrato e' il
    // suo, non il ripiego della pagina, che vale solo se il corpo non ne porta.
    const user = await renderConContesto();
    postMock.mockRejectedValueOnce(
      httpError(429, "Limite di utilizzo del modello AI raggiunto per questo mese."),
    );
    await user.click(screen.getByRole("button", { name: /Analisi Sicurezza OWASP/ }));

    await user.click(screen.getByRole("button", { name: "Avvia operazione" }));

    expect(
      await screen.findByText(/Limite di utilizzo del modello AI raggiunto/),
    ).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("se il contesto non esiste piu' (404) invita a ricrearlo", async () => {
    const user = await renderConContesto();
    postMock.mockRejectedValueOnce(httpError(404));
    await user.click(screen.getByRole("button", { name: /Analisi Sicurezza OWASP/ }));

    await user.click(screen.getByRole("button", { name: "Avvia operazione" }));

    expect(await screen.findByText(/Contesto non trovato/)).toBeInTheDocument();
  });

  it("per ogni altro errore mostra un messaggio generico di avvio fallito", async () => {
    const user = await renderConContesto();
    postMock.mockRejectedValueOnce(httpError(500));
    await user.click(screen.getByRole("button", { name: /Analisi Sicurezza OWASP/ }));

    await user.click(screen.getByRole("button", { name: "Avvia operazione" }));

    expect(await screen.findByText(/Errore durante l'avvio delle operazioni/)).toBeInTheDocument();
  });

  it("cambiando selezione dopo un errore il messaggio sparisce", async () => {
    const user = await renderConContesto();
    postMock.mockRejectedValueOnce(httpError(500));
    await user.click(screen.getByRole("button", { name: /Analisi Sicurezza OWASP/ }));
    await user.click(screen.getByRole("button", { name: "Avvia operazione" }));
    await screen.findByText(/Errore durante l'avvio/);

    await user.click(screen.getByRole("button", { name: /Verifica Policy/ }));

    expect(screen.queryByText(/Errore durante l'avvio/)).not.toBeInTheDocument();
  });

  it("consente di tornare alla selezione del repository per cambiare contesto", async () => {
    const user = await renderConContesto();

    await user.click(screen.getByRole("button", { name: "Cambia contesto" }));

    expect(navigateMock).toHaveBeenCalledWith({ to: "/select" });
  });
});
