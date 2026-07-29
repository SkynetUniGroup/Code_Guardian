import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { OctokitGitHubClient } from './github-client.service';
import { CONTEXT_REPOSITORY } from '../domain/repositories/repository.interfaces';
import type { IAnalysisContextRepository } from '../domain/repositories/repository.interfaces';
import { CreateContextDto } from '../common/dto/context.dto';

@Injectable()
export class RepositoryContextService {
  private readonly SUPPORTED_EXTENSIONS = ['ts', 'js', 'py'];
  private readonly MAX_FILES = 100; // Limite RF.31

  constructor(
    private readonly githubClient: OctokitGitHubClient,
    @Inject(CONTEXT_REPOSITORY) private readonly contextRepo: IAnalysisContextRepository,
  ) {}

  async buildContext(userId: string, dto: CreateContextDto) {
    // 1. Risolve il branch/tag in uno SHA immutabile
    const resolvedSha = await this.githubClient.resolveRefToSha(userId, dto.repoOwner, dto.repoName, dto.ref);
    
    // 2. Ottiene dettagli (privato/pubblico)
    const repoDetails = await this.githubClient.getRepoDetails(userId, dto.repoOwner, dto.repoName);

    // 3. Scarichiamo l'albero completo del repository a partire dallo SHA risolto
    // Passiamo 'null' come taskId perché siamo in fase di setup, la task non esiste ancora
    const treeNodes = await this.githubClient.getTree(null, userId, dto.repoOwner, dto.repoName, resolvedSha);
    
    // Filtriamo i file in base allo scope e ai paths passati nel DTO
    let files = treeNodes.filter((node: any) => node.type === 'file');
    
    if (dto.scopeType !== 'FULL_REPOSITORY' && dto.paths && dto.paths.length > 0) {
      files = files.filter((f: any) => dto.paths!.some(p => f.path.startsWith(p)));
    }

    // Estraiamo le estensioni uniche
    const detectedLanguages = [...new Set(files
      .map((f: any) => f.path.split('.').pop()?.toLowerCase())
      .filter((ext: string) => ext && this.SUPPORTED_EXTENSIONS.includes(ext))
    )] as string[];

    const estimatedFileCount = files.length;

    // Eseguiamo le asserzioni REALI
    this.assertSupportedLanguages(detectedLanguages);
    this.assertWithinSizeLimits(estimatedFileCount);

    return this.contextRepo.create({
      userId,
      repoOwner: dto.repoOwner,
      repoName: dto.repoName,
      isPrivate: repoDetails.private,
      resolvedSha,
      scopeType: dto.scopeType,
      paths: dto.paths || [],
      detectedLanguages,
      estimatedFileCount,
    });
  }

  private assertSupportedLanguages(languages: string[]) {
    if (!languages || languages.length === 0) {
      throw new BadRequestException('Nessun linguaggio supportato rilevato nell\'ambito selezionato (richiesti: TS, JS o Python).');
    }
  }

  private assertWithinSizeLimits(count: number) {
    if (count > this.MAX_FILES) {
      throw new BadRequestException(`L'ambito selezionato contiene ${count} file, superando il limite di ${this.MAX_FILES}.`);
    }
    if (count === 0) {
      throw new BadRequestException('L\'ambito selezionato è vuoto o non contiene file analizzabili.');
    }
  }
}