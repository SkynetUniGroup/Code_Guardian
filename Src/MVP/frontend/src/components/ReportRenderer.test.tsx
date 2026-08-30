import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReportRenderer from './ReportRenderer';
import type { ReportBlock, FindingBlock } from '../types';

const finding = (overrides: Partial<FindingBlock> = {}): FindingBlock => ({
  kind: 'finding',
  order: 0,
  owaspCategory: 'A01: Broken Access Control',
  severity: 'high',
  filePath: 'src/main.ts',
  startLine: 10,
  endLine: 12,
  explanation: 'Spiegazione della vulnerabilita\'.',
  remediation: 'Applicare il controllo di autorizzazione.',
  ...overrides,
});

describe('ReportRenderer', () => {
  it('renderizza un blocco di testo formattato preservando il markdown grezzo', () => {
    const blocks: ReportBlock[] = [{ kind: 'text', order: 0, markdown: '# Titolo\n\nContenuto' }];

    render(<ReportRenderer blocks={blocks} />);

    expect(screen.getByText(/# Titolo/)).toBeInTheDocument();
  });

  it('renderizza un finding con categoria OWASP, gravita\', file, righe e remediation', () => {
    render(<ReportRenderer blocks={[finding()]} />);

    expect(screen.getByText('A01: Broken Access Control')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByText(/src\/main\.ts/)).toBeInTheDocument();
    expect(screen.getByText(/10 - 12/)).toBeInTheDocument();
    expect(screen.getByText('Applicare il controllo di autorizzazione.')).toBeInTheDocument();
  });

  it('applica lo stile della badge corretto per ciascun livello di gravita\' noto', () => {
    const severities: FindingBlock['severity'][] = ['info', 'low', 'medium', 'high', 'critical'];

    severities.forEach((severity) => {
      const { unmount } = render(<ReportRenderer blocks={[finding({ severity })]} />);
      expect(screen.getByText(severity).className).toContain('border');
      unmount();
    });
  });

  it('usa uno stile di fallback neutro per una gravita\' non riconosciuta (difensivo)', () => {
    // Cast intenzionale: verifichiamo la resilienza a un valore fuori enum,
    // scenario plausibile se il backend introduce una nuova severity non
    // ancora nota al frontend.
    const block = finding({ severity: 'unknown-severity' as FindingBlock['severity'] });

    render(<ReportRenderer blocks={[block]} />);

    const badge = screen.getByText('unknown-severity');
    expect(badge.className).toContain('bg-gray-100');
  });

  it('renderizza una violazione di policy con regola, file e azione richiesta', () => {
    const blocks: ReportBlock[] = [{
      kind: 'policy_violation',
      order: 0,
      ruleId: 'POL-3',
      ruleText: 'Non usare eval()',
      filePath: 'src/utils/eval.ts',
      explanation: 'Uso di eval() individuato.',
      remediation: 'Sostituire con JSON.parse.',
    }];

    render(<ReportRenderer blocks={blocks} />);

    expect(screen.getByText(/POL-3/)).toBeInTheDocument();
    expect(screen.getByText('Non usare eval()', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Sostituire con JSON.parse.', { exact: false })).toBeInTheDocument();
  });

  it('renderizza una voce di changelog con riferimento issue, titolo e dettaglio', () => {
    const blocks: ReportBlock[] = [{
      kind: 'changelog_item',
      order: 0,
      issueRef: '#42',
      title: 'Aggiunta autenticazione JWT',
      detail: 'Implementato login e refresh token.',
    }];

    render(<ReportRenderer blocks={blocks} />);

    expect(screen.getByText('#42')).toBeInTheDocument();
    expect(screen.getByText('Aggiunta autenticazione JWT')).toBeInTheDocument();
    expect(screen.getByText('Implementato login e refresh token.')).toBeInTheDocument();
  });

  it('ordina i blocchi secondo il campo "order" indipendentemente dall\'ordine di arrivo', () => {
    const blocks: ReportBlock[] = [
      { kind: 'text', order: 2, markdown: 'terzo' },
      { kind: 'text', order: 0, markdown: 'primo' },
      { kind: 'text', order: 1, markdown: 'secondo' },
    ];

    render(<ReportRenderer blocks={blocks} />);

    const rendered = screen.getAllByText(/primo|secondo|terzo/).map((el) => el.textContent);
    expect(rendered).toEqual(['primo', 'secondo', 'terzo']);
  });

  it('non muta l\'array di blocchi passato come prop durante l\'ordinamento', () => {
    const blocks: ReportBlock[] = [
      { kind: 'text', order: 1, markdown: 'b' },
      { kind: 'text', order: 0, markdown: 'a' },
    ];
    const originalOrder = blocks.map((b) => (b as any).markdown);

    render(<ReportRenderer blocks={blocks} />);

    expect(blocks.map((b) => (b as any).markdown)).toEqual(originalOrder);
  });

  it('con lista vuota non renderizza alcun blocco', () => {
    const { container } = render(<ReportRenderer blocks={[]} />);
    expect(container.querySelectorAll('.border-gray-200')).toHaveLength(0);
  });
});
