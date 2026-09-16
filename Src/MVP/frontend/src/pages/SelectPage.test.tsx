import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSelectionStore } from "../stores/selectionStore";

/**
 * Un rifiuto del server nella forma in cui arriva davvero alla pagina.
 *
 * Dev'essere un AxiosError vero: toApiError legge stato ed envelope solo dopo
 * `err instanceof AxiosError`, e con un Error qualunque la pagina non vede ne'
 * il codice ne' il messaggio del backend e mostra sempre il testo generico.
 */
function erroreHttp(status: number, corpo: Record<string, unknown> = {}) {
  return new AxiosError("Request failed", String(status), undefined, undefined, {
    status,
    data: corpo,
    statusText: "",
    headers: {},
    config: {},
  } as never);
}

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

const getMock = vi.fn();
const postMock = vi.fn();
vi.mock("../api/client", () => ({
  apiClient: {
    get: (...args: any[]) => getMock(...args),
    post: (...args: any[]) => postMock(...args),
  },
}));

const { SelectPage } = await import("./SelectPage");

const initialSelection = useSelectionStore.getState();

const REPOS = [
  { owner: "SkynetUniGroup", name: "Code_Guardian", defaultBranch: "develop", isPrivate: false },
  { owner: "OWASP", name: "NodeGoat", defaultBranch: "master", isPrivate: true },
];

/** Contesto nella forma restituita da POST /contexts. */
const CONTESTO_CREATO = {
  data: {
    id: "ctx-1",
    repoOwner: "OWASP",
    repoName: "NodeGoat",
    isPrivate: true,
    resolvedSha: "abc1234",
    scopeType: "FULL_REPOSITORY",
    paths: [],
    detectedLanguages: ["JavaScript"],
    estimatedFileCount: 42,
  },
};

/**
 * L'etichetta della tendina, come la scrive la pagina. Non e' piu'
 * "Repository": da quando accanto alla tendina c'e' anche il campo "Oppure
 * incolla l'URL di un repository pubblico", il selettore si chiama "Seleziona
 * repository" per distinguere i due modi di indicare il repository.
 */
const ETICHETTA_REPO = "Seleziona repository";

/** Monta la pagina e attende che l'elenco dei repository sia caricato. */
async function renderCaricata() {
  render(<SelectPage />);
  await screen.findByLabelText(ETICHETTA_REPO);
  return userEvent.setup();
}

const BOTTONE = /Salva contesto e vai ad Avvia/;

beforeEach(() => {
  useSelectionStore.setState(initialSelection, true);
  navigateMock.mockReset();
  postMock.mockReset();
  getMock.mockReset().mockResolvedValue({ data: REPOS });
});

describe("SelectPage", () => {
  it("mostra uno stato di caricamento finche' i repository non sono arrivati", () => {
    getMock.mockReturnValueOnce(new Promise(() => {}));

    render(<SelectPage />);

    expect(screen.getByText(/Caricamento repository/)).toBeInTheDocument();
  });

  it("elenca i repository accessibili segnalando quelli privati", async () => {
    await renderCaricata();

    const opzioni = screen.getAllByRole("option").map((o) => o.textContent);
    expect(opzioni).toContain("SkynetUniGroup/Code_Guardian ");
    expect(opzioni).toContain("OWASP/NodeGoat 🔒");
  });

  it("se i repository non si caricano lo attribuisce alle credenziali e offre di riprovare", async () => {
    getMock.mockRejectedValueOnce(new Error("401"));

    render(<SelectPage />);

    expect(await screen.findByText(/Impossibile caricare i repository/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Riprova" })).toBeInTheDocument();
  });

  it("scegliendo un repository propone il suo branch di default come riferimento", async () => {
    const user = await renderCaricata();

    await user.selectOptions(screen.getByLabelText(ETICHETTA_REPO), "OWASP/NodeGoat");

    expect(screen.getByLabelText("Branch")).toHaveValue("master");
  });

  it("crea il contesto sull'intero repository e prosegue verso l'avvio", async () => {
    const user = await renderCaricata();
    postMock.mockResolvedValueOnce(CONTESTO_CREATO);
    await user.selectOptions(screen.getByLabelText(ETICHETTA_REPO), "OWASP/NodeGoat");

    await user.click(screen.getByRole("button", { name: BOTTONE }));

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/run" }));
    expect(postMock).toHaveBeenCalledWith("/contexts", {
      repoUrl: "https://github.com/OWASP/NodeGoat",
      branch: "master",
      scopeType: "FULL_REPOSITORY",
    });
  });

  it("memorizza il contesto creato, cosi' la pagina di avvio non deve richiederlo", async () => {
    const user = await renderCaricata();
    postMock.mockResolvedValueOnce(CONTESTO_CREATO);
    await user.selectOptions(screen.getByLabelText(ETICHETTA_REPO), "OWASP/NodeGoat");

    await user.click(screen.getByRole("button", { name: BOTTONE }));

    await waitFor(() => expect(useSelectionStore.getState().contextId).toBe("ctx-1"));
    expect(useSelectionStore.getState().context).toEqual(CONTESTO_CREATO.data);
  });

  it("accetta un commit specifico accanto al branch", async () => {
    // Il campo unico "Branch o Commit SHA" e' diventato due campi distinti:
    // il branch resta obbligatorio, il commit e' un di piu' che lo ancora.
    const user = await renderCaricata();
    postMock.mockResolvedValueOnce(CONTESTO_CREATO);
    await user.selectOptions(screen.getByLabelText(ETICHETTA_REPO), "OWASP/NodeGoat");
    await user.type(screen.getByLabelText(/Commit SHA/), "a1b2c3d4e5f6");

    await user.click(screen.getByRole("button", { name: BOTTONE }));

    await waitFor(() => expect(postMock).toHaveBeenCalled());
    // Il commit viaggia in `commitSha`, non al posto del branch: RF.22 ancora
    // il contesto a un commit preciso, e senza branch il backend non saprebbe
    // dove cercarlo.
    expect(postMock.mock.calls[0][1].branch).toBe("master");
    expect(postMock.mock.calls[0][1].commitSha).toBe("a1b2c3d4e5f6");
  });

  it("restringe l'ambito a singoli file, uno per riga", async () => {
    const user = await renderCaricata();
    postMock.mockResolvedValueOnce(CONTESTO_CREATO);
    await user.selectOptions(screen.getByLabelText(ETICHETTA_REPO), "OWASP/NodeGoat");
    await user.selectOptions(screen.getByLabelText("Tipo di scope"), "FILES");
    await user.type(
      screen.getByLabelText("File da analizzare"),
      "app/routes/session.js\napp/data/user-dao.js",
    );

    await user.click(screen.getByRole("button", { name: BOTTONE }));

    await waitFor(() => expect(postMock).toHaveBeenCalled());
    expect(postMock.mock.calls[0][1]).toMatchObject({
      scopeType: "FILES",
      paths: ["app/routes/session.js", "app/data/user-dao.js"],
    });
  });

  it("restringe l'ambito a directory, cambiando anche l'etichetta del campo", async () => {
    const user = await renderCaricata();
    postMock.mockResolvedValueOnce(CONTESTO_CREATO);
    await user.selectOptions(screen.getByLabelText(ETICHETTA_REPO), "OWASP/NodeGoat");
    await user.selectOptions(screen.getByLabelText("Tipo di scope"), "DIRECTORIES");
    await user.type(screen.getByLabelText("Directory da analizzare"), "app/routes");

    await user.click(screen.getByRole("button", { name: BOTTONE }));

    await waitFor(() => expect(postMock).toHaveBeenCalled());
    expect(postMock.mock.calls[0][1]).toMatchObject({
      scopeType: "DIRECTORIES",
      paths: ["app/routes"],
    });
  });

  it("ignora righe vuote e spazi nell'elenco dei percorsi", async () => {
    const user = await renderCaricata();
    postMock.mockResolvedValueOnce(CONTESTO_CREATO);
    await user.selectOptions(screen.getByLabelText(ETICHETTA_REPO), "OWASP/NodeGoat");
    await user.selectOptions(screen.getByLabelText("Tipo di scope"), "FILES");
    await user.type(screen.getByLabelText("File da analizzare"), "  app/a.js  \n\n\napp/b.js\n");

    await user.click(screen.getByRole("button", { name: BOTTONE }));

    await waitFor(() => expect(postMock).toHaveBeenCalled());
    expect(postMock.mock.calls[0][1].paths).toEqual(["app/a.js", "app/b.js"]);
  });

  it("sull'intero repository non chiede percorsi e non ne invia", async () => {
    const user = await renderCaricata();
    postMock.mockResolvedValueOnce(CONTESTO_CREATO);
    await user.selectOptions(screen.getByLabelText(ETICHETTA_REPO), "OWASP/NodeGoat");

    expect(screen.queryByLabelText("File da analizzare")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: BOTTONE }));

    await waitFor(() => expect(postMock).toHaveBeenCalled());
    expect(postMock.mock.calls[0][1]).not.toHaveProperty("paths");
  });

  it("cambiando tipo di scope azzera i percorsi gia' inseriti", async () => {
    const user = await renderCaricata();
    await user.selectOptions(screen.getByLabelText(ETICHETTA_REPO), "OWASP/NodeGoat");
    await user.selectOptions(screen.getByLabelText("Tipo di scope"), "FILES");
    await user.type(screen.getByLabelText("File da analizzare"), "app/a.js");

    await user.selectOptions(screen.getByLabelText("Tipo di scope"), "DIRECTORIES");

    // I percorsi dei file non hanno senso come directory: vanno reinseriti.
    expect(screen.getByLabelText("Directory da analizzare")).toHaveValue("");
  });

  it("blocca l'invio se non e' stato scelto alcun repository", async () => {
    const user = await renderCaricata();

    await user.click(screen.getByRole("button", { name: BOTTONE }));

    expect(await screen.findByText(/Seleziona un repository o incolla l'URL/)).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("blocca l'invio se il branch e' stato svuotato", async () => {
    const user = await renderCaricata();
    await user.selectOptions(screen.getByLabelText(ETICHETTA_REPO), "OWASP/NodeGoat");
    await user.clear(screen.getByLabelText("Branch"));

    await user.click(screen.getByRole("button", { name: BOTTONE }));

    expect(await screen.findByText("Inserisci il branch")).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("blocca l'invio se l'ambito ristretto non elenca alcun percorso", async () => {
    const user = await renderCaricata();
    await user.selectOptions(screen.getByLabelText(ETICHETTA_REPO), "OWASP/NodeGoat");
    await user.selectOptions(screen.getByLabelText("Tipo di scope"), "FILES");

    await user.click(screen.getByRole("button", { name: BOTTONE }));

    expect(await screen.findByText("Inserisci almeno un percorso")).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("se il server rifiuta il contesto riporta il suo messaggio e resta sulla pagina", async () => {
    // Copre gli scarti lato server che non riguardano un campo preciso:
    // repository irraggiungibile, ambito oltre i limiti dimensionali. Il
    // messaggio mostrato e' quello del backend, non un generico "errore".
    const user = await renderCaricata();
    postMock.mockRejectedValueOnce(
      erroreHttp(422, {
        code: "CONTEXT_RESOURCE_INVALID",
        message: "Il repository supera i limiti dimensionali previsti.",
      }),
    );
    await user.selectOptions(screen.getByLabelText(ETICHETTA_REPO), "OWASP/NodeGoat");

    await user.click(screen.getByRole("button", { name: BOTTONE }));

    expect(
      await screen.findByText("Il repository supera i limiti dimensionali previsti."),
    ).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(useSelectionStore.getState().contextId).toBeNull();
  });

  it("uno scarto che riguarda il branch finisce sotto il campo Branch", async () => {
    // Quando il backend dice *quale* campo non va, l'errore non deve finire
    // nel banner in cima alla pagina: va accanto al campo da correggere.
    const user = await renderCaricata();
    postMock.mockRejectedValueOnce(
      erroreHttp(404, {
        code: "CONTEXT_RESOURCE_MISSING",
        message: 'Branch "master" non trovato nel repository OWASP/NodeGoat.',
      }),
    );
    await user.selectOptions(screen.getByLabelText(ETICHETTA_REPO), "OWASP/NodeGoat");

    await user.click(screen.getByRole("button", { name: BOTTONE }));

    expect(
      await screen.findByText('Branch "master" non trovato nel repository OWASP/NodeGoat.'),
    ).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("un guasto senza messaggio leggibile ricade sul testo generico", async () => {
    const user = await renderCaricata();
    postMock.mockRejectedValueOnce("guasto senza forma nota");
    await user.selectOptions(screen.getByLabelText(ETICHETTA_REPO), "OWASP/NodeGoat");

    await user.click(screen.getByRole("button", { name: BOTTONE }));

    expect(await screen.findByText(/Impossibile salvare il contesto/)).toBeInTheDocument();
    expect(useSelectionStore.getState().contextId).toBeNull();
  });

  it("disabilita il pulsante mentre il contesto viene creato", async () => {
    const user = await renderCaricata();
    let concludi: (v: unknown) => void = () => {};
    postMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          concludi = resolve;
        }),
    );
    await user.selectOptions(screen.getByLabelText(ETICHETTA_REPO), "OWASP/NodeGoat");
    const bottone = screen.getByRole("button", { name: BOTTONE });

    await user.click(bottone);

    await waitFor(() => expect(bottone).toBeDisabled());
    concludi(CONTESTO_CREATO);
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
  });
});
