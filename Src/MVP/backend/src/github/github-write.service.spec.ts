import { type Mock, vi } from "vitest";

// Same mocking approach as github-client.service.spec.ts: a fake Octokit so
// these stay fast, deterministic unit tests of our own branch/commit/PR
// sequencing rather than real network calls.
const mockRequest = vi.fn();
// `vi.mock`, non `vi.fn`: con vi.fn il modulo non veniva sostituito affatto e i
// test chiamavano GitHub davvero, prendendosi un 401 che il servizio traduce
// (correttamente) in PR_CREATION_FAILED — quindi i test fallivano su un errore
// che non c'entrava nulla con cio' che volevano verificare.
// Function classica e non arrow: il servizio fa `new Octokit(...)`.
vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(function Octokit() {
    return { request: mockRequest };
  }),
}));

import { Test, type TestingModule } from "@nestjs/testing";
import { AppException } from "../common/exceptions/app.exception";
import { GithubClientService } from "./github-client.service";
import { GithubWriteService } from "./github-write.service";

describe("GithubWriteService", () => {
  let service: GithubWriteService;
  let githubClient: {
    resolveRefToSha: Mock;
    getFileContent: Mock;
  };

  const change = {
    operationCode: "DOCS_README",
    targetPath: "README.md",
    diffUnified: "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n",
    title: "Update README",
  };

  beforeEach(async () => {
    mockRequest.mockReset();
    githubClient = {
      resolveRefToSha: vi.fn().mockResolvedValue("base-sha"),
      getFileContent: vi.fn().mockResolvedValue({
        path: "README.md",
        content: "old\n",
        sha: "file-sha",
        language: "unknown",
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [GithubWriteService, { provide: GithubClientService, useValue: githubClient }],
    }).compile();

    service = module.get(GithubWriteService);
  });

  it("creates blobs, tree, commit, ref, and opens a PR for a multi-file compatible diff", async () => {
    mockRequest
      .mockResolvedValueOnce({ data: { sha: "new-blob-sha" } }) // create blob
      .mockResolvedValueOnce({ data: { sha: "new-tree-sha" } }) // create tree
      .mockResolvedValueOnce({ data: { sha: "new-commit-sha" } }) // create commit
      .mockResolvedValueOnce({}) // create ref
      .mockResolvedValueOnce({
        data: { html_url: "https://github.com/owner/repo/pull/7" },
      }); // create PR

    const url = await service.openPullRequestForProposal("token", "owner", "repo", "main", change);

    expect(url).toBe("https://github.com/owner/repo/pull/7");
    expect(githubClient.resolveRefToSha).toHaveBeenCalledWith("token", "owner", "repo", "main");

    // Blob creation
    const createBlobCall = mockRequest.mock.calls[0] as [string, { content: string }];
    expect(createBlobCall[0]).toBe("POST /repos/{owner}/{repo}/git/blobs");
    expect(Buffer.from(createBlobCall[1].content, "base64").toString()).toBe("new\n");

    // Tree creation
    const createTreeCall = mockRequest.mock.calls[1] as [string, { base_tree: string; tree: any[] }];
    expect(createTreeCall[0]).toBe("POST /repos/{owner}/{repo}/git/trees");
    expect(createTreeCall[1].base_tree).toBe("base-sha");
    expect(createTreeCall[1].tree[0].path).toBe("README.md");
    expect(createTreeCall[1].tree[0].sha).toBe("new-blob-sha");

    // Commit creation
    const createCommitCall = mockRequest.mock.calls[2] as [string, { tree: string; parents: string[] }];
    expect(createCommitCall[0]).toBe("POST /repos/{owner}/{repo}/git/commits");
    expect(createCommitCall[1].tree).toBe("new-tree-sha");
    expect(createCommitCall[1].parents).toEqual(["base-sha"]);

    // Branch (ref) creation
    const createRefCall = mockRequest.mock.calls[3] as [string, { ref: string; sha: string }];
    expect(createRefCall[0]).toBe("POST /repos/{owner}/{repo}/git/refs");
    expect(createRefCall[1].ref).toMatch(/^refs\/heads\/codeguardian\/docs-readme\/[0-9a-f]{8}$/);
    expect(createRefCall[1].sha).toBe("new-commit-sha");

    // PR creation
    const createPrCall = mockRequest.mock.calls[4] as [string, { base: string; head: string }];
    expect(createPrCall[0]).toBe("POST /repos/{owner}/{repo}/pulls");
    expect(createPrCall[1].base).toBe("main");
    expect(createPrCall[1].head).toBe(createRefCall[1].ref.replace("refs/heads/", ""));
  });

  it("treats a missing file as new content when the agent proposes a brand-new file", async () => {
    githubClient.getFileContent.mockRejectedValue({ status: 404 });
    mockRequest
      .mockResolvedValueOnce({ data: { sha: "new-blob-sha" } })
      .mockResolvedValueOnce({ data: { sha: "new-tree-sha" } })
      .mockResolvedValueOnce({ data: { sha: "new-commit-sha" } })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        data: { html_url: "https://github.com/owner/repo/pull/8" },
      });

    const newFileChange = {
      ...change,
      diffUnified: "--- /dev/null\n+++ b/README.md\n@@ -0,0 +1 @@\n+hello\n",
    };

    await service.openPullRequestForProposal("token", "owner", "repo", "main", newFileChange);

    const createBlobCall = mockRequest.mock.calls[0] as [string, { content: string }];
    expect(Buffer.from(createBlobCall[1].content, "base64").toString()).toBe("hello\n");
  });

  it("throws PR_CREATION_FAILED when GitHub refuses the write with 403", async () => {
    mockRequest.mockRejectedValue({ status: 403, message: "Forbidden" });

    await expect(
      service.openPullRequestForProposal("token", "owner", "repo", "main", change),
    ).rejects.toBeInstanceOf(AppException);

    try {
      await service.openPullRequestForProposal("token", "owner", "repo", "main", change);
      // `fail()` e' di Jasmine/Jest e in Vitest non esiste: qui basta
      // un'asserzione che non puo' passare se si arriva a questa riga.
      expect.unreachable("la chiamata avrebbe dovuto fallire");
    } catch (error) {
      expect((error as AppException).code).toBe("PR_CREATION_FAILED");
    }
  });

  it("leaves a network failure uncaught so it falls through to UPSTREAM", async () => {
    mockRequest.mockRejectedValue({ status: 502, message: "Bad Gateway" });

    await expect(
      service.openPullRequestForProposal("token", "owner", "repo", "main", change),
    ).rejects.not.toBeInstanceOf(AppException);
  });

  it("throws a plain error, not PR_CREATION_FAILED, when the diff does not apply", async () => {
    githubClient.getFileContent.mockResolvedValue({
      path: "README.md",
      content: "completely different content",
      sha: "file-sha",
      language: "unknown",
    });

    await expect(
      service.openPullRequestForProposal("token", "owner", "repo", "main", change),
    ).rejects.not.toBeInstanceOf(AppException);
    // No GitHub call should have been made at all: the patch is checked
    // before any write is attempted.
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
