import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AnalysisContext,
  AnalysisContextDocument,
} from './schemas/analysis-context.schema';
import { CredentialsService } from '../credentials/credentials.service';
import { GithubClientService } from '../github/github-client.service';
import { detectLanguage } from '../github/language-detection';
import { TreeNode } from '../github/github-client.types';
import { RepoResolverService } from './repo-resolver.service';
import { normalizePaths } from './path-normalization';
import { isReadmeNonEnglish } from './readme-language';
import { FRANC } from './franc.provider';
import type { FrancFn } from './franc.provider';
import { CreateContextDto } from './dto/create-context.dto';
import { AnalysisContextDto } from './dto/analysis-context.dto';

const GITHUB_PROVIDER = 'GITHUB';

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
  // ("Sequenza di validazione"), in order, stopping at the first failure.
  // Nothing is persisted until every step passes.
  async create(
    userId: string,
    dto: CreateContextDto,
  ): Promise<AnalysisContextDto> {
    const token = await this.credentials.getDecryptedToken(
      userId,
      GITHUB_PROVIDER,
    );

    // Steps 1-3: URL syntax (enforced by the DTO's @Matches before this
    // method ever runs), owner/repo extraction, reachability + isPrivate.
    const { owner, repo, isPrivate } = await this.repoResolver.resolve(
      token,
      dto.repoUrl,
    );

    // Step 4: branch existence (RF.21). listRefs also gives us the branch's
    // HEAD sha, reused directly in step 6 — no second call.
    const refs = await this.githubClient.listRefs(token, owner, repo);
    const branchRef = refs.branches.find((b) => b.name === dto.branch);
    if (!branchRef) {
      throw new NotFoundException(
        `Branch "${dto.branch}" not found in ${owner}/${repo}.`,
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
      if (comparison.status !== 'ahead' && comparison.status !== 'identical') {
        throw new UnprocessableEntityException(
          `Commit ${dto.commitSha} does not belong to branch "${dto.branch}".`,
        );
      }
    }

    // Step 6: SHA anchoring (RF.17) — derived, no call.
    const resolvedSha = dto.commitSha ?? branchRef.sha;

    // Step 7: language detection (RF.24, RV.7). The tree read here is
    // reused by step 9 below — fetched once, per the design doc.
    const tree = await this.githubClient.getTree(
      token,
      owner,
      repo,
      resolvedSha,
    );
    const detectedLanguages = this.detectLanguages(tree);

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
      dto.scopeType === 'FULL_REPOSITORY'
        ? []
        : normalizePaths(dto.paths ?? []);
    if (dto.scopeType === 'FULL_REPOSITORY') {
      if (dto.paths && dto.paths.length > 0) {
        throw new BadRequestException(
          'paths must be omitted when scopeType is FULL_REPOSITORY.',
        );
      }
    } else if (normalizedPaths.length === 0) {
      throw new BadRequestException(
        `paths must contain at least one entry when scopeType is ${dto.scopeType}.`,
      );
    }

    // Step 9: scope existence (RF.30) — reuses the step-7 tree, no second
    // read.
    if (dto.scopeType !== 'FULL_REPOSITORY') {
      const expectedType = dto.scopeType === 'FILES' ? 'file' : 'dir';
      const byPath = new Map(tree.map((entry) => [entry.path, entry]));
      for (const path of normalizedPaths) {
        const entry = byPath.get(path);
        if (!entry) {
          throw new BadRequestException(
            `Path "${path}" does not exist in ${owner}/${repo} at ${resolvedSha}.`,
          );
        }
        if (entry.type !== expectedType) {
          throw new BadRequestException(
            `Path "${path}" is a ${entry.type}, not a ${expectedType}, but scopeType is ${dto.scopeType}.`,
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
      estimatedFileCount: this.estimateFileCount(
        dto.scopeType,
        normalizedPaths,
        tree,
      ),
      nonEnglishReadmeDetected,
    });

    return this.toDto(context);
  }

  // FULL_REPOSITORY: every file in the tree. FILES: exactly the selected
  // paths. DIRECTORIES: every file whose path falls under one of the
  // selected prefixes, recursively — the doc is explicit that expansion
  // happens at read time and this is that read.
  private estimateFileCount(
    scopeType: CreateContextDto['scopeType'],
    paths: string[],
    tree: TreeNode[],
  ): number {
    const files = tree.filter((entry) => entry.type === 'file');
    if (scopeType === 'FULL_REPOSITORY') {
      return files.length;
    }
    if (scopeType === 'FILES') {
      return paths.length;
    }
    return files.filter((file) =>
      paths.some(
        (prefix) => file.path === prefix || file.path.startsWith(`${prefix}/`),
      ),
    ).length;
  }

  private detectLanguages(tree: TreeNode[]): string[] {
    return [
      ...new Set(
        tree
          .filter((entry) => entry.type === 'file')
          .map((entry) => detectLanguage(entry.path))
          .filter((language) => language !== 'unknown'),
      ),
    ];
  }

  private async checkReadmeLanguage(
    token: string,
    owner: string,
    repo: string,
    resolvedSha: string,
  ): Promise<boolean> {
    try {
      const readme = await this.githubClient.getReadme(
        token,
        owner,
        repo,
        resolvedSha,
      );
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
      estimatedFileCount: context.estimatedFileCount,
      nonEnglishReadmeDetected: context.nonEnglishReadmeDetected,
    };
  }
}
