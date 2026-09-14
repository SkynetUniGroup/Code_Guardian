import { randomBytes } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import { Octokit } from "@octokit/rest";
import { applyPatch, parsePatch } from "diff";
import { AppException } from "../common/exceptions/app.exception";
import { GithubClientService } from "./github-client.service";
import { OCTOKIT_TIMEOUT_MS } from "./octokit-timeout";

export interface ProposalChange {
  operationCode: string;
  targetPath: string;
  diffUnified: string;
  title: string;
}

@Injectable()
export class GithubWriteService {
  constructor(private readonly githubClient: GithubClientService) {}

  private writeClient(token: string): Octokit {
    return new Octokit({
      auth: token,
      request: { signal: AbortSignal.timeout(OCTOKIT_TIMEOUT_MS) },
    });
  }

  private generateBranchName(operationCode: string): string {
    const scope = operationCode.toLowerCase().replace(/_/g, "-");
    const shortId = randomBytes(4).toString("hex");
    return `codeguardian/${scope}/${shortId}`;
  }

  private isUnauthorized(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error.status === 401 || error.status === 403)
    );
  }

  private isNotFound(error: unknown): boolean {
    return typeof error === "object" && error !== null && "status" in error && error.status === 404;
  }

  private async readExistingFile(
    token: string,
    owner: string,
    repo: string,
    path: string,
    baseSha: string,
  ): Promise<{ content: string; sha: string } | null> {
    try {
      const file = await this.githubClient.getFileContent(token, owner, repo, path, baseSha);
      return { content: file.content, sha: file.sha };
    } catch (error) {
      if (this.isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async openPullRequestForProposal(
    token: string,
    owner: string,
    repo: string,
    baseBranch: string,
    change: ProposalChange,
  ): Promise<string> {
    const baseSha = await this.githubClient.resolveRefToSha(token, owner, repo, baseBranch);
    const branchName = this.generateBranchName(change.operationCode);
    const client = this.writeClient(token);

    try {
      const patches = parsePatch(change.diffUnified);
      const treeNodes: Array<{ path: string; mode: "100644"; type: "blob"; sha: string }> = [];

      for (const patch of patches) {
        const rawPath = patch.newFileName || patch.oldFileName;
        if (!rawPath) continue;
        const filePath = rawPath.replace(/^[ab]\//, "");

        const existing = await this.readExistingFile(token, owner, repo, filePath, baseSha);
        const newContent = applyPatch(existing?.content ?? "", patch);

        if (newContent === false) {
          throw new Error(
            `Diff for ${filePath} does not apply against the current file content (base ${baseSha}).`,
          );
        }

        const { data: blob } = await client.request("POST /repos/{owner}/{repo}/git/blobs", {
          owner,
          repo,
          content: Buffer.from(newContent, "utf8").toString("base64"),
          encoding: "base64",
        });

        treeNodes.push({
          path: filePath,
          mode: "100644",
          type: "blob",
          sha: blob.sha,
        });
      }

      if (treeNodes.length === 0) {
        throw new Error("No valid patches found in the proposal.");
      }

      const { data: newTree } = await client.request("POST /repos/{owner}/{repo}/git/trees", {
        owner,
        repo,
        base_tree: baseSha,
        tree: treeNodes,
      });

      const { data: newCommit } = await client.request("POST /repos/{owner}/{repo}/git/commits", {
        owner,
        repo,
        message: `Code Guardian: ${change.title}`,
        tree: newTree.sha,
        parents: [baseSha],
      });

      await client.request("POST /repos/{owner}/{repo}/git/refs", {
        owner,
        repo,
        ref: `refs/heads/${branchName}`,
        sha: newCommit.sha,
      });

      const { data: pr } = await client.request("POST /repos/{owner}/{repo}/pulls", {
        owner,
        repo,
        title: change.title,
        head: branchName,
        base: baseBranch,
        body: "Opened automatically by Code Guardian. Review the diff before merging.",
      });

      return pr.html_url;
    } catch (error) {
      if (this.isUnauthorized(error)) {
        throw new AppException(
          "PR_CREATION_FAILED",
          "GitHub refused to open the Pull Request (missing permission or invalid token).",
          HttpStatus.BAD_GATEWAY,
        );
      }
      throw error;
    }
  }
}