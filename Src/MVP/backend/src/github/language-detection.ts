// Extension-based heuristic, deliberately simple: no content inspection.
// Shared by GithubClientService.getFileContent (tags a single file) and
// RepositoriesService.tree (aggregates detectedLanguages across a whole
// tree) — extracted here so both stay the same function, not two copies
// that can drift.
export function detectLanguage(path: string): string {
  const extension = path.split('.').pop();
  switch (extension) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'py':
      return 'python';
    default:
      return 'unknown';
  }
}
