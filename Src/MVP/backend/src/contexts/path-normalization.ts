// "nessuno slash iniziale, nessun segmento ./ o .., duplicati eliminati"
// (mvp_backend_design.tex, Validazione dell'ambito). Segments equal to '.'
// or '..' are dropped outright, not resolved against the rest of the
// path — this is input sanitization against representing the same path two
// ways (or attempting traversal), not a general-purpose path resolver.
export function normalizePaths(paths: string[]): string[] {
  const normalized = paths.map((path) =>
    path
      .split('/')
      .filter(
        (segment) => segment !== '' && segment !== '.' && segment !== '..',
      )
      .join('/'),
  );
  return [...new Set(normalized)];
}
