// Manual smoke test for BE-9 (GithubWriteService) against a real, throwaway
// GitHub repository — not part of the app, not run by any npm script,
// nothing imports it. Delete it once BE-15 exists and wires this into a
// real Task, or keep it around as a manual sanity check; either is fine.
//
// Usage (PowerShell): see the instructions given alongside this file.
import Redis from 'ioredis';
import { GithubClientService } from '../src/github/github-client.service';
import { GithubWriteService } from '../src/github/github-write.service';

const token = process.env.TEST_GITHUB_TOKEN;
const owner = process.env.TEST_GITHUB_OWNER;
const repo = process.env.TEST_GITHUB_REPO;
const branch = process.env.TEST_GITHUB_BRANCH ?? 'main';
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

if (!token || !owner || !repo) {
  console.error(
    'Set TEST_GITHUB_TOKEN, TEST_GITHUB_OWNER, TEST_GITHUB_REPO before running this script.',
  );
  process.exit(1);
}

// A brand-new file, deliberately: it sidesteps needing the diff's context
// lines to match some existing file's exact content, which is the fiddliest
// part to get right by hand. This is the same "diff against the void" case
// mvp_backend_design.tex calls out for a new README.
const diffUnified = [
  '--- /dev/null',
  '+++ b/CODE_GUARDIAN_TEST.md',
  '@@ -0,0 +1,3 @@',
  '+# Code Guardian test',
  '+',
  '+This file was created automatically by GithubWriteService (BE-9) as a smoke test.',
  '',
].join('\n');

async function main() {
  const redis = new Redis(redisUrl);
  const githubClient = new GithubClientService(redis);
  const githubWrite = new GithubWriteService(githubClient);

  console.log(`Opening a PR against ${owner}/${repo}@${branch}...`);

  const url = await githubWrite.openPullRequestForProposal(
    token!,
    owner!,
    repo!,
    branch,
    {
      operationCode: 'DOCS_README',
      targetPath: 'CODE_GUARDIAN_TEST.md',
      diffUnified,
      title: 'Code Guardian BE-9 smoke test',
    },
  );

  console.log(`Pull Request opened: ${url}`);
  redis.disconnect();
}

main().catch((error: unknown) => {
  console.error('Failed:', error);
  process.exit(1);
});
