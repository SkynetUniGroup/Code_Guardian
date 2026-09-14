// Extension-based heuristic, deliberately simple: no content inspection.
// Shared by GithubClientService.getFileContent (tags a single file) and
// RepositoriesService.tree (aggregates detectedLanguages across a whole
// tree) — extracted here so both stay the same function, not two copies
// that can drift.

// I tre linguaggi che gli agenti sanno analizzare. Dichiarati qui e non
// sparsi nei singoli agenti perche' e' questa lista a decidere cosa finisce
// in `detectedLanguages` e cosa in `unsupportedLanguages`.
export const SUPPORTED_LANGUAGES = ["typescript", "javascript", "python"] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// Estensione -> linguaggio, per i soli linguaggi *supportati*.
const SUPPORTED_BY_EXTENSION: Record<string, SupportedLanguage> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
};

// Estensione -> linguaggio, per il codice che gli agenti *non* sanno
// analizzare.
//
// Questa tabella e' il cuore di RF.24: senza, un repository interamente
// scritto in Go produce `detectedLanguages: []`, cioe' un contesto
// indistinguibile da quello di un repository vuoto, e nessuno strato a valle
// puo' piu' ricavare l'avviso perche' il dato e' gia' stato buttato.
//
// Contiene solo linguaggi di programmazione veri: Markdown, JSON, YAML, i
// lockfile e le immagini non ci sono di proposito, perche' un README non e'
// "codice in un linguaggio non supportato" e segnalarlo come tale renderebbe
// l'avviso rumore su ogni repository esistente.
const UNSUPPORTED_BY_EXTENSION: Record<string, string> = {
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  rs: "rust",
  rb: "ruby",
  php: "php",
  cs: "c#",
  c: "c",
  h: "c",
  cc: "c++",
  cpp: "c++",
  cxx: "c++",
  hpp: "c++",
  hh: "c++",
  m: "objective-c",
  mm: "objective-c",
  swift: "swift",
  scala: "scala",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  lua: "lua",
  pl: "perl",
  pm: "perl",
  r: "r",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ps1: "powershell",
  sql: "sql",
  vb: "visual basic",
  groovy: "groovy",
  clj: "clojure",
  zig: "zig",
};

function extensionOf(path: string): string {
  const name = path.split("/").pop() ?? path;
  // Un file senza punti (`Makefile`, `Dockerfile`) non ha estensione: senza
  // questo controllo `split('.').pop()` restituirebbe il nome intero e
  // basterebbe un file chiamato `go` per far comparire l'avviso.
  if (!name.includes(".")) {
    return "";
  }
  return (name.split(".").pop() ?? "").toLowerCase();
}

// Il linguaggio di un file quando e' fra quelli supportati, `'unknown'`
// altrimenti.
//
// Firma invariata: la usano il tag del singolo file in GithubClientService e
// l'elenco dei repository, e in entrambi i casi "supportato o no" e' esattamente
// la domanda a cui devono rispondere.
export function detectLanguage(path: string): string {
  return SUPPORTED_BY_EXTENSION[extensionOf(path)] ?? "unknown";
}

// Il linguaggio di un file anche quando non e' supportato, `null` per tutto
// cio' che non e' codice.
//
// Distinta da detectLanguage() e non un suo parametro booleano perche' i due
// valori di ritorno hanno significati diversi: qui `null` vuol dire "non e'
// codice", mentre li' `'unknown'` vuol dire "e' codice che non sappiamo
// analizzare" — accorparle costringerebbe ogni chiamante a distinguere due
// casi che non gli interessano.
export function detectAnyLanguage(path: string): string | null {
  const extension = extensionOf(path);
  return SUPPORTED_BY_EXTENSION[extension] ?? UNSUPPORTED_BY_EXTENSION[extension] ?? null;
}

export function isSupportedLanguage(language: string): boolean {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(language);
}
