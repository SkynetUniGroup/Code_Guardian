import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ReportRenderer from "./ReportRenderer";
import type {
  Block,
  FindingBlock,
  PolicyViolationBlock,
  ChangelogItemBlock,
  TextBlock,
} from "../types";

const finding = (overrides: Partial<FindingBlock> = {}): FindingBlock => ({
  kind: "FINDING",
  category: "A01: Broken Access Control",
  severity: "HIGH",
  filePath: "src/main.ts",
  lineStart: 10,
  lineEnd: 12,
  description: "Spiegazione della vulnerabilita'.",
  remediation: { kind: "TEXT", text: "Applicare il controllo di autorizzazione." },
  ...overrides,
});

const policyViolation = (overrides: Partial<PolicyViolationBlock> = {}): PolicyViolationBlock => ({
  kind: "POLICY_VIOLATION",
  ruleId: "POL-3",
  ruleText: "Non usare eval()",
  filePath: "src/utils/eval.ts",
  explanation: "Uso di eval() individuato.",
  severity: "HIGH",
  remediation: { kind: "TEXT", text: "Sostituire con JSON.parse." },
  ...overrides,
});

const textBlock = (overrides: Partial<TextBlock> = {}): TextBlock => ({
  kind: "TEXT",
  markdown: "# Titolo\n\nContenuto",
  ...overrides,
});

const changelogBlock = (overrides: Partial<ChangelogItemBlock> = {}): ChangelogItemBlock => ({
  kind: "CHANGELOG_ITEM",
  issueRef: "#42",
  title: "Aggiunta autenticazione JWT",
  detail: "Implementato login e refresh token.",
  ...overrides,
});

describe("ReportRenderer", () => {
  it("renderizza un blocco di testo formattato preservando il markdown grezzo", () => {
    const blocks: Block[] = [textBlock()];

    render(<ReportRenderer blocks={blocks} />);

    expect(screen.getByText(/# Titolo/)).toBeInTheDocument();
  });

  it("renderizza un finding con categoria, gravita, file, righe e rimedio", () => {
    render(<ReportRenderer blocks={[finding()]} />);

    expect(screen.getByText("A01: Broken Access Control")).toBeInTheDocument();
    expect(screen.getByText("Alto")).toBeInTheDocument();
    expect(screen.getByText(/src\/main\.ts/)).toBeInTheDocument();
    expect(screen.getByText(/10 - 12/)).toBeInTheDocument();
    expect(screen.getByText("Applicare il controllo di autorizzazione.")).toBeInTheDocument();
  });

  it("applica lo stile della badge corretto per ciascun livello di gravita' noto", () => {
    const severities: Array<{ severity: FindingBlock["severity"]; label: string }> = [
      { severity: "INFO", label: "Info" },
      { severity: "LOW", label: "Basso" },
      { severity: "MEDIUM", label: "Medio" },
      { severity: "HIGH", label: "Alto" },
      { severity: "CRITICAL", label: "Critico" },
    ];

    severities.forEach(({ severity, label }) => {
      const { unmount } = render(<ReportRenderer blocks={[finding({ severity })]} />);
      expect(screen.getByText(label).className).toContain("rounded");
      unmount();
    });
  });

  it("usa uno stile di fallback neutro per una gravita' non riconosciuta (difensivo)", () => {
    // Cast intenzionale: verifichiamo la resilienza a un valore fuori enum,
    // scenario plausibile se il backend introduce una nuova severity non
    // ancora nota al frontend.
    const block = finding({ severity: "UNKNOWN_SEVERITY" as FindingBlock["severity"] });

    render(<ReportRenderer blocks={[block]} />);

    const badge = screen.getByText("UNKNOWN_SEVERITY");
    expect(badge.className).toContain("bg-gray-100");
  });

  it("renderizza una violazione di policy con regola, file e azione richiesta", () => {
    const blocks: Block[] = [policyViolation()];

    render(<ReportRenderer blocks={blocks} />);

    expect(screen.getByText(/POL-3/)).toBeInTheDocument();
    expect(screen.getByText("Non usare eval()", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Sostituire con JSON.parse.", { exact: false })).toBeInTheDocument();
  });

  it("renderizza una voce di changelog con riferimento issue, titolo e dettaglio", () => {
    const blocks: Block[] = [changelogBlock()];

    render(<ReportRenderer blocks={blocks} />);

    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("Aggiunta autenticazione JWT")).toBeInTheDocument();
    expect(screen.getByText("Implementato login e refresh token.")).toBeInTheDocument();
  });

  it("renderizza piu blocchi di testo nella sequenza fornita", () => {
    const blocks: Block[] = [
      textBlock({ markdown: "primo" }),
      textBlock({ markdown: "secondo" }),
      textBlock({ markdown: "terzo" }),
    ];

    render(<ReportRenderer blocks={blocks} />);

    expect(screen.getByText("primo")).toBeInTheDocument();
    expect(screen.getByText("secondo")).toBeInTheDocument();
    expect(screen.getByText("terzo")).toBeInTheDocument();
  });

  it("non muta l'array di blocchi passato come prop", () => {
    const blocks: Block[] = [textBlock({ markdown: "b" }), textBlock({ markdown: "a" })];
    const originalOrder = blocks.map((b) => (b as any).markdown);

    render(<ReportRenderer blocks={blocks} />);

    expect(blocks.map((b) => (b as any).markdown)).toEqual(originalOrder);
  });

  it("con lista vuota non renderizza alcun blocco", () => {
    const { container } = render(<ReportRenderer blocks={[]} />);
    expect(container.querySelectorAll(".border-gray-200")).toHaveLength(0);
  });
});
