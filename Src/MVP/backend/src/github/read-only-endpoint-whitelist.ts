import {
  GET_TREE_ROUTE,
  GET_FILE_CONTENT_ROUTE,
  LIST_ISSUES_ROUTE,
  GET_ISSUE_DETAIL_ROUTE,
} from './github-routes';

// The closed list of GitHub routes reachable through BE-8's internal
// facade. compareCommits, verifyToken, listRepositories, and getRepository
// are backend-direct and deliberately excluded (mvp_backend_design.tex,
// GitHub Integration section): RS.3 constrains agents, not the backend's
// own calls. Built from the same constants GithubClientService uses to make
// these exact requests, so this list and the real outgoing routes can't
// drift apart.
export const READ_ONLY_ENDPOINT_WHITELIST = [
  GET_TREE_ROUTE,
  GET_FILE_CONTENT_ROUTE,
  LIST_ISSUES_ROUTE,
  GET_ISSUE_DETAIL_ROUTE,
] as const;

export function isReadOnlyEndpointAllowed(route: string): boolean {
  return (READ_ONLY_ENDPOINT_WHITELIST as readonly string[]).includes(route);
}
