import { AxiosError } from "axios";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "../stores/sessionStore";

const getMock = vi.fn();
const postMock = vi.fn();
vi.mock("../api/client", () => ({
  apiClient: {
    get: (...args: any[]) => getMock(...args),
    post: (...args: any[]) => postMock(...args),
  },
}));

const { CredentialsPage } = await import("./CredentialsPage");

const initialSession = useSessionStore.getState();

const PAT_VALIDO = "ghp_1234567890abcdef";

/** Credenziale nella forma restituita dal backend: nessun segreto, nessuno stato. */
function credenziale(connectedAt = "2026-08-20T10:30:00Z") {
  return { id: "cred-1", provider: "GITHUB", connectedAt };
}

function httpError(status: number, code?: string, message?: string) {
  // Dev'essere un AxiosError vero: toApiError legge il corpo solo dopo un
  // `err instanceof AxiosError`, quindi un oggetto con la sola forma giusta
  // gli arriva come errore generico e il `code` va perduto. E il codice
  // serve: e' su quello che la pagina distingue un token rifiutato da un
  // guasto qualunque.
  const data: Record<string, string> = {};
  if (code) data.code = code;
  if (message) data.message = message;
  return new AxiosError(
    message ?? "Request failed",
    String(status),
    undefined,
    undefined,
    { status, data, statusText: "", headers: {}, config: {} } as never,
  );
}

/** Monta la pagina attendendo la fine della lettura iniziale. */
async function renderCaricata() {
  render(<CredentialsPage />);
  await screen.findByText("Stato credenziali");
  return userEvent.setup();
}

async function inserisciPat(user: ReturnType<typeof userEvent.setup>, pat = PAT_VALIDO) {
  await user.type(screen.getByLabelText(/GitHub Personal Access Token/), pat);
}

const SALVA = /Salva e verifica/;

beforeEach(() => {
  useSessionStore.setState(initialSession, true);
  getMock.mockReset().mockResolvedValue({ data: [] });
  postMock.mockReset();
});

describe("CredentialsPage", () => {
  describe("stato iniziale", () => {
    it("legge le credenziali memorizzate al montaggio", async () => {
      getMock.mockResolvedValueOnce({ data: [credenziale()] });

      await renderCaricata();

      expect(getMock).toHaveBeenCalledWith("/credentials");
      expect(useSessionStore.getState().credentialsStatus).toBe("CONNECTED");
      expect(screen.getByText("Connessa e valida")).toBeInTheDocument();
    });

    it("considera configurata la credenziale per il solo fatto che esiste", async () => {
      // Il backend verifica il token su GitHub prima di salvarlo: una
      // credenziale memorizzata e' per costruzione una che ha funzionato.
      getMock.mockResolvedValueOnce({ data: [credenziale()] });

      await renderCaricata();

      expect(useSessionStore.getState().credentialsStatus).toBe("CONNECTED");
    });

    it("segnala l'assenza quando il server non restituisce credenziali", async () => {
      getMock.mockResolvedValueOnce({ data: [] });

      await renderCaricata();

      expect(useSessionStore.getState().credentialsStatus).toBe("MISSING");
      expect(screen.getByText("Non configurata")).toBeInTheDocument();
    });

    it("ignora le credenziali di altri provider", async () => {
      getMock.mockResolvedValueOnce({
        data: [{ id: "x", provider: "ALTRO", connectedAt: "2026-08-20T10:30:00Z" }],
      });

      await renderCaricata();

      expect(useSessionStore.getState().credentialsStatus).toBe("MISSING");
    });

    it("se la lettura fallisce lascia lo stato indeterminato, senza bloccare", async () => {
      getMock.mockRejectedValueOnce(new Error("backend giu"));

      await renderCaricata();

      // Una GET fallita dice che non siamo riusciti a leggere, non che la
      // credenziale manchi: declassare a MISSING farebbe scattare i guard di
      // rotta su un'informazione non verificata.
      expect(useSessionStore.getState().credentialsStatus).toBe("UNKNOWN");
    });

    it("mostra la data dell'ultima verifica", async () => {
      getMock.mockResolvedValueOnce({ data: [credenziale()] });

      await renderCaricata();

      expect(screen.getByText(/Ultima validazione:/)).toBeInTheDocument();
    });

    it("senza credenziale non propone di verificarla di nuovo", async () => {
      await renderCaricata();

      expect(screen.queryByRole("button", { name: /Verifica di nuovo/ })).not.toBeInTheDocument();
    });
  });

  describe("salvataggio", () => {
    it("invia il token nella forma che il backend dichiara", async () => {
      const user = await renderCaricata();
      postMock.mockResolvedValueOnce({ data: credenziale() });
      await inserisciPat(user);

      await user.click(screen.getByRole("button", { name: SALVA }));

      await waitFor(() =>
        expect(postMock).toHaveBeenCalledWith("/credentials", {
          provider: "GITHUB",
          token: PAT_VALIDO,
        }),
      );
    });

    it("salvare e verificare sono un passo solo", async () => {
      // Il backend interroga GitHub prima di persistere: una POST riuscita
      // significa gia' token valido, non serve una seconda chiamata.
      const user = await renderCaricata();
      postMock.mockResolvedValueOnce({ data: credenziale() });
      await inserisciPat(user);

      await user.click(screen.getByRole("button", { name: SALVA }));

      await waitFor(() => expect(useSessionStore.getState().credentialsStatus).toBe("CONNECTED"));
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    it("dopo il salvataggio svuota il campo, cosi' il segreto non resta nel browser", async () => {
      const user = await renderCaricata();
      postMock.mockResolvedValueOnce({ data: credenziale() });
      await inserisciPat(user);

      await user.click(screen.getByRole("button", { name: SALVA }));

      await waitFor(() =>
        expect(screen.getByLabelText(/GitHub Personal Access Token/)).toHaveValue(""),
      );
    });

    it("mostra la data di verifica restituita dal salvataggio", async () => {
      const user = await renderCaricata();
      postMock.mockResolvedValueOnce({ data: credenziale("2026-09-05T09:00:00Z") });
      await inserisciPat(user);

      await user.click(screen.getByRole("button", { name: SALVA }));

      expect(await screen.findByText(/05\/09\/26/)).toBeInTheDocument();
    });

    it("se GitHub rifiuta il token lo dichiara e marca le credenziali non valide", async () => {
      const user = await renderCaricata();
      postMock.mockRejectedValueOnce(
        httpError(400, "CREDENTIAL_INVALID", "GitHub rejected this token."),
      );
      await inserisciPat(user);

      await user.click(screen.getByRole("button", { name: SALVA }));

      // La pagina mostra il messaggio del backend quando c'e', e tiene il
      // proprio solo come ripiego: e' quello che l'utente legge davvero.
      expect(await screen.findByText(/GitHub rejected this token/)).toBeInTheDocument();
      expect(useSessionStore.getState().credentialsStatus).toBe("INVALID");
    });

    it("distingue un guasto del server dal token rifiutato", async () => {
      // Un 500 non dice nulla sul token: marcarlo invalido manderebbe
      // l'utente a rigenerarne uno perfettamente buono.
      const user = await renderCaricata();
      postMock.mockRejectedValueOnce(httpError(500, undefined, "Internal server error"));
      await inserisciPat(user);

      await user.click(screen.getByRole("button", { name: SALVA }));

      // Quello che l'utente legge e' il messaggio del backend: apiErrorMessage
      // usa il proprio ripiego solo se il corpo non ne porta uno.
      expect(await screen.findByText(/Internal server error/)).toBeInTheDocument();
      expect(useSessionStore.getState().credentialsStatus).not.toBe("INVALID");
    });

    it("dichiara la verifica in corso e blocca il pulsante", async () => {
      const user = await renderCaricata();
      let concludi: (v: unknown) => void = () => {};
      postMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            concludi = resolve;
          }),
      );
      await inserisciPat(user);

      await user.click(screen.getByRole("button", { name: SALVA }));

      const bottone = await screen.findByRole("button", { name: /Verifica in corso/ });
      expect(bottone).toBeDisabled();
      concludi({ data: credenziale() });
      await waitFor(() => expect(bottone).not.toBeDisabled());
    });
  });

  describe("validazione del formato", () => {
    it("non rifiuta un PAT dal formato inatteso: decide GitHub", async () => {
      // Scelta deliberata, documentata in create-credential.dto.ts: il formato
      // dei PAT e' cambiato piu' volte (classico a 40 esadecimali, poi ghp_,
      // poi github_pat_). Un controllo di forma qui produrrebbe falsi negativi
      // al prossimo cambio, mentre la verifica vera -- il token vale o no --
      // la fa il backend chiedendolo a GitHub.
      const user = await renderCaricata();
      await inserisciPat(user, "token-qualsiasi");

      await user.click(screen.getByRole("button", { name: SALVA }));

      await waitFor(() => expect(postMock).toHaveBeenCalled());
      expect(postMock.mock.calls[0][1].token).toBe("token-qualsiasi");
    });

    it("accetta il formato github_pat_ dei token a granularita' fine", async () => {
      const user = await renderCaricata();
      postMock.mockResolvedValueOnce({ data: credenziale() });
      await inserisciPat(user, "github_pat_11ABCDE");

      await user.click(screen.getByRole("button", { name: SALVA }));

      await waitFor(() => expect(postMock).toHaveBeenCalled());
      expect(postMock.mock.calls[0][1].token).toBe("github_pat_11ABCDE");
    });

    it("segnala il campo lasciato vuoto", async () => {
      const user = await renderCaricata();

      await user.click(screen.getByRole("button", { name: SALVA }));

      expect(await screen.findByText("Inserisci il GitHub Personal Access Token")).toBeInTheDocument();
      expect(postMock).not.toHaveBeenCalled();
    });

    it("toglie l'errore appena l'utente corregge il campo", async () => {
      const user = await renderCaricata();
      await user.click(screen.getByRole("button", { name: SALVA }));
      await screen.findByText("Inserisci il GitHub Personal Access Token");

      await inserisciPat(user, "g");

      expect(screen.queryByText("Inserisci il GitHub Personal Access Token")).not.toBeInTheDocument();
    });
  });

  describe("nuova verifica su richiesta", () => {
    it("richiede al backend di ricontrollare il token memorizzato", async () => {
      getMock.mockResolvedValueOnce({ data: [credenziale()] });
      const user = await renderCaricata();
      postMock.mockResolvedValueOnce({ data: credenziale("2026-09-05T09:00:00Z") });

      await user.click(screen.getByRole("button", { name: /Verifica di nuovo/ }));

      await waitFor(() => expect(postMock).toHaveBeenCalledWith("/credentials/cred-1/validate"));
      expect(await screen.findByText(/05\/09\/26/)).toBeInTheDocument();
    });

    it("se il token memorizzato non vale piu' lo dichiara", async () => {
      getMock.mockResolvedValueOnce({ data: [credenziale()] });
      const user = await renderCaricata();
      postMock.mockRejectedValueOnce(
        httpError(400, "CREDENTIAL_INVALID", "La credenziale non è più valida."),
      );

      await user.click(screen.getByRole("button", { name: /Verifica di nuovo/ }));

      expect(await screen.findByText(/La credenziale non è più valida/)).toBeInTheDocument();
      expect(useSessionStore.getState().credentialsStatus).toBe("INVALID");
    });
  });
});
