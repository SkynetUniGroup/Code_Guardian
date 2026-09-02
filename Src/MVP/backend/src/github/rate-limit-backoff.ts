const RATE_LIMIT_REMAINING_THRESHOLD = 10;
const RATE_LIMIT_BACKOFF_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Slows down instead of failing when GitHub's quota is close to running out.
// Kept free of any Octokit/Redis dependency on purpose — it's pure logic
// ("given these headers, wait if needed") shared by every GithubClientService
// call regardless of who's asking, agent or backend direct.
export async function backoffIfRateLimited(
  headers: Record<string, string | number | undefined>,
  onBackoff?: (remaining: number) => void,
): Promise<void> {
  const remaining = Number(headers['x-ratelimit-remaining']);
  if (Number.isNaN(remaining) || remaining >= RATE_LIMIT_REMAINING_THRESHOLD) {
    return;
  }
  onBackoff?.(remaining);
  await sleep(RATE_LIMIT_BACKOFF_MS);
}
