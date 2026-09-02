export const GET_TREE_ROUTE = 'GET /repos/{owner}/{repo}/git/trees/{tree_sha}';
export const GET_FILE_CONTENT_ROUTE =
  'GET /repos/{owner}/{repo}/contents/{path}';
export const LIST_ISSUES_ROUTE = 'GET /repos/{owner}/{repo}/issues';
export const GET_ISSUE_DETAIL_ROUTE =
  'GET /repos/{owner}/{repo}/issues/{issue_number}';
// Backend-direct only (RV.8's README language check, POST /contexts) — never
// imported into read-only-endpoint-whitelist.ts. Agents have no reason to
// call this: they read whatever the context's scope names, and a README
// specifically isn't part of any agent's contract.
export const GET_README_ROUTE = 'GET /repos/{owner}/{repo}/readme';
