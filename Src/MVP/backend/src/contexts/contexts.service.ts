import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AppException } from "../common/exceptions/app.exception";
import { InjectModel } from "@nestjs/mongoose";
import type { Model } from "mongoose";
import { CredentialsService } from "../credentials/credentials.service";
import { GithubClientService } from "../github/github-client.service";
import type { TreeNode } from "../github/github-client.types";
import { detectAnyLanguage, isSupportedLanguage } from "../github/language-detection";
import type { AnalysisContextDto } from "./dto/analysis-context.dto";
import type { CreateContextDto } from "./dto/create-context.dto";
import type { FrancFn } from "./franc.provider";
import { FRANC } from "./franc.provider";
import { normalizePaths } from "./path-normalization";
import { isReadmeNonEnglish } from "./readme-language";
import { RepoResolverService } from "./repo-resolver.service";
import { AnalysisContext, type AnalysisContextDocument } from "./schemas/analysis-context.schema";

const GITHUB_PROVIDER = "GITHUB";

@Injectable()
export class ContextsService {
  constructor(
    @InjectModel(AnalysisContext.name)
    private readonly contextModel: Model<AnalysisContextDocument>,
    private readonly credentials: CredentialsService,
    private readonly githubClient: GithubClientService,
    private readonly repoResolver: RepoResolverService,
    @Inject(FRANC) private readonly franc: FrancFn,
  ) {}

  // Implements the ten-step sequence from mvp_backend_design.tex
  // ("Validation sequence"), in order, stopping at the first failure.
  // Nothing is persisted until every step passes.
  async create(userId: string, dto: CreateContextDto): Promise<AnalysisContextDto> {
    const token = await this.credentials.getDecryptedToken(userId, GITHUB_PROVIDER);

    // Steps 1-3: URL syntax (enforced by the DTO's @Matches before this
    // method ever runs), owner/repo extraction, reachability + isPrivate.
    const { owner, repo, isPrivate } = await thi
s.repoResolver.resolve(token, dto.repoUrl);

    // Step 4: branch existence (RF.21). listRefs also gives us the branch's
    // HEAD sha, reused directly in step 6 — no second call.
    const branchRef = await this.githubClient.getBranch(
      token,
      owner,
      repo,
      dto.branch,
    );

    if (!branchRef) {
      throw new AppException(
        "CONTEXT_RESOURCE_MISSING",
        `Branch "${dto.branch}" not found in repository ${owner}/${repo}.`,
        HttpStatus.NOT_FOUND,
      );
    }

    // Step 5: commit membership (RF.22), only if commitSha was supplied.
    if (dto.commitSha) {
      const comparison = await this.githubClient.compareCommits(
        token,
        owner,
        repo,
        dto.commitSha,
        branchRef.sha,
      );

      if (comparison.status !== "ahead" && comparison.status !== "identical") {
        throw new AppException(
          "CONTEXT_RESOURCE_INVALID",
          `Commit ${dto.commitSha} does not belong to branch "${dto.branch}".`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }

    // Step 6: SHA anchoring (RF.17) — derived, no call.
    const resolvedSha = dto.commitSha ?? branchRef.sha;

    // Step 7: language detection (RF.24, RV.7). The tree read here is
    // reused by step 9 below — fetched once, per the design doc.
    const tree = await this.githubClient.getTree(token, owner, repo, resolvedSha);
    const { detectedLanguages, unsupportedLanguages, predominantLanguage } =
      this.detectLanguages(tree);

    // RV.8: non-blocking, best-effort — a missing README or a detection
    // hiccup must never fail context creation over what is, at most, a
    // warning banner.
    const nonEnglishReadmeDetected = await this.checkReadmeLanguage(
      token,
      owner,
      repo,
      resolvedSha,
    );

    // Step 8: non-empty scope (RF.29) — declarative, no I/O.
    const normalizedPaths =
      dto.scopeType === "FULL_REPOSITORY" ? [] : normalizePaths(dto.paths ?? []);

    if (dto.scopeType === "FULL_REPOSITORY") {
      if (dto.paths && dto.paths.length > 0) {
        throw new AppException(
          "CONTEXT_RESOURCE_INVALID",
          "paths must be omitted when scopeType is FULL_REPOSITORY.",
          HttpStatus.BAD_REQUEST,
        );
      }
    } else if (normalizedPaths.length === 0) {
      throw new AppException(
        "CONTEXT_RESOURCE_MISSING",
        `paths must contain at least one entry when scopeType is ${dto.scopeType}.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Step 9: scope existence (RF.30) — reuses the step-7 tree, no second
    // read.
    if (dto.scopeType !== "FULL_REPOSITORY") {
      const expectedType = dto.scopeType === "FILES" ? "file" : "dir";
      const byPath = new Map(tree.map((entry) => [entry.path, entry]));
      for (const path of normalizedPaths) {
        const entry = byPath.get(path);
        if (!entry) {
          throw new AppException(
            "CONTEXT_RESOURCE_MISSING",
            `Path "${path}" does not exist in ${owner}/${repo}.`,
            HttpStatus.BAD_REQUEST,
          );
        }
        if (entry.type !== expectedType) {
          throw new AppException(
            "CONTEXT_RESOURCE_INVALID",
            `Path "${path}" is a ${entry.type}, not a ${expectedType}, but scopeType is ${dto.scopeType}.`,
            HttpStatus.BAD_REQUEST,
          );
        }
      }
    }

    // Step 10: persistence (RF.15).
    const context = await this.contextModel.create({
      userId,
      repoUrl: dto.repoUrl,
      repoOwner: owner,
      repoName: repo,
      isPrivate,
      branch: dto.branch,
      resolvedSha,
      scopeType: dto.scopeType,
      paths: normalizedPaths,
      detectedLanguages,
      unsupportedLanguages,
      predominantLanguage,
      estimatedFileCount: this.estimateFileCount(dto.scopeType, normalizedPaths, tree),
      nonEnglishReadmeDetected,
    });

    return this.toDto(context);
  }

  // FULL_REPOSITORY: every file in t
he tree. FILES: exactly the selected
  // paths. DIRECTORIES: every file whose path falls under one of the
  // selected prefixes, recursively — the doc is explicit that expansion
  // happens at read time and this is that read.
  private estimateFileCount(
    scopeType: CreateContextDto["scopeType"],
    paths: string[],
    tree: TreeNode[],
  ): number {
    const files = tree.filter((entry) => entry.type === "file");
    if (scopeType === "FULL_REPOSITORY") {
      return files.length;
    }
    if (scopeType === "FILES") {
      return paths.length;
    }
    return files.filter((file) =>
      paths.some((prefix) => file.path === prefix || file.path.startsWith(`${prefix}/`)),
    ).length;
  }

  // RF.24/RV.7: which languages are in the repository, split between those
  // the agents can analyse and those they cannot, plus the predominant one.
  //
  // The previous version discarded unrecognised files *before* reaching the
  // context (`.filter(l => l !== 'unknown')`), and with them the information
  // necessary for the warning: a repository entirely in Go came out with
  // `detectedLanguages: []`, identical to an empty repository, and no
  // downstream layer could tell them apart anymore.
  //
  // The predominant language is calculated by number of files and not by
  // bytes: it is a coarser estimate but does not require reading the tree
  // objects, and here it only serves to choose the tone of the warning.
  private detectLanguages(tree: TreeNode[]): {
    detectedLanguages: string[];
    unsupportedLanguages: string[];
    predominantLanguage: string | null;
  } {
    const counts = new Map<string, number>();
    for (const entry of tree) {
      if (entry.type !== "file") {
        continue;
      }
      const language = detectAnyLanguage(entry.path);
      if (language === null) {
        continue;
      }
      counts.set(language, (counts.get(language) ?? 0) + 1);
    }

    // Sorting by descending file count, with name as the tie-breaker:
    // without it, two languages with the same count would swap places
    // between one context creation and the next, and the warning would
    // change text without anything having changed.
    const byFrequency = [...counts.entries()].sort(
      ([leftName, leftCount], [rightName, rightCount]) =>
        rightCount - leftCount || leftName.localeCompare(rightName),
    );

    return {
      detectedLanguages: byFrequency.map(([name]) => name).filter(isSupportedLanguage),
      unsupportedLanguages: byFrequency
        .map(([name]) => name)
        .filter((name) => !isSupportedLanguage(name)),
      predominantLanguage: byFrequency[0]?.[0] ?? null,
    };
  }

  private async checkReadmeLanguage(
    token: string,
    owner: string,
    repo: string,
    resolvedSha: string,
  ): Promise<boolean> {
    try {
      const readme = await this.githubClient.getReadme(token, owner, repo, resolvedSha);
      if (!readme) {
        return false;
      }
      return isReadmeNonEnglish(readme.content, this.franc);
    } catch {
      // Best-effort: a language-detection hiccup is a lost warning, not a
      // reason to fail context creation.
      return false;
    }
  }

  private toDto(context: AnalysisContextDocument): AnalysisContextDto {
    return {
      id: context._id.toString(),
      repoOwner: context.repoOwner,
      repoName: context.repoName,
      isPrivate: context.isPrivate,
      branch: context.branch,
      resolvedSha: context.resolvedSha,
      scopeType: context.scopeType,
      detectedLanguages: context.detectedLanguages,
      unsupportedLanguages: context.unsupportedLanguages ?? [],
      predominantLanguage: context.predominantLanguage ?? null,
      // Derived and not stored: it is a function of the two fields above,
      // and a boolean persisted alongside the data it depends on is only
      // another way for them to diverge.
      //
      // The threshold is the *predominant* language, not the mere presence of
      // unsupported code: almost every repository contains at least one
      // shell script, and a warning that always appears is read by no one
      // anymore. The full list remains in `unsupportedLanguages` regardless,
      // for those who want to show it in every case.
      unsupportedLanguageWarning:
        (context.unsupportedLanguages ?? []).length > 0 &&
        !isSupportedLanguage(context.predominantLanguage ?? ""),
      estimatedFileCount: context.estimatedFileCount,
      nonEnglishReadmeDetected: context.nonEnglishReadmeDetected,
    };
  }
}
