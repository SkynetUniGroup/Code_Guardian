// Every Octokit client in this codebase gets this as its request timeout.
// Without one, a connection that's gone stale — e.g. the container's
// network path changing underneath a long-running process, confirmed
// happening in dev on 2026-08-31 after a burst of container rebuilds —
// hangs for whatever the OS-level TCP timeout happens to be (observed: 1-2
// minutes) before failing, instead of failing fast with a clear error. A
// timed-out request throws a plain Error with no `status`, so it falls
// through to UPSTREAM the same way any other unclassified failure does.
export const OCTOKIT_TIMEOUT_MS = 20_000;
