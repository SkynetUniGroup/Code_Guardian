// Anchors the host to github.com (GitHub is the only supported provider) and
// requires exactly two path segments — nothing more, nothing less — so
// owner/repo extraction below never has to guess where the repo name ends.
// Used both as a class-validator @Matches() constraint on every query/body
// DTO that accepts a repoUrl, and by parseGithubUrl() itself.
export const GITHUB_REPO_URL_REGEX =
  /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)$/;

export interface ParsedGithubUrl {
  owner: string;
  repo: string;
}

// Defensive only: every caller validates repoUrl against
// GITHUB_REPO_URL_REGEX via @Matches() before this ever runs, so a
// non-matching input here would mean a DTO forgot that decorator, not a bad
// request that reached this function legitimately.
export function parseGithubUrl(repoUrl: string): ParsedGithubUrl {
  const match = GITHUB_REPO_URL_REGEX.exec(repoUrl);
  if (!match) {
    throw new Error(`Not a valid GitHub repository URL: ${repoUrl}`);
  }
  return { owner: match[1], repo: match[2] };
}
