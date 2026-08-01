import { Injectable, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
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
    let resolvedSha: string;
    let repoDetails: any;

    try {
      // 1. Risolve il branch/tag in uno SHA immutabile
      resolvedSha = await this.githubClient.resolveRefToSha(userId, dto.repoOwner, dto.repoName, dto.ref);
      
      // 2. Ottiene dettagli (privato/pubblico)
      repoDetails = await this.githubClient.getRepoDetails(userId, dto.repoOwner, dto.repoName);
    } catch (error: any) {
      // TRADUZIONE DEGLI ERRORI GITHUB IN MESSAGGI UTILI PER IL FRONTEND
      if (error.status === 404) {
        throw new NotFoundException(`Il repository '${dto.repoOwner}/${dto.repoName}' o il branch '${dto.ref}' non esiste. Verifica di aver digitato correttamente i nomi.`);
      }
      if (error.status === 401 || error.status === 403) {
        throw new BadRequestException('Accesso negato a GitHub: verifica la validità del tuo Token PAT e i permessi.');
      }
      throw error;
    }

    // 3. Scarichiamo l'albero completo del repository a partire dallo SHA risolto
    const treeNodes = await this.githubClient.getTree(null, userId, dto.repoOwner, dto.repoName, resolvedSha);
    
    // Filtriamo i file in base allo scope e ai paths passati nel DTO
    let files = treeNodes.filter((node: any) => node.type === 'file');
    
    if (dto.scopeType !== 'FULL_REPOSITORY') {
      if (!dto.paths || dto.paths.length === 0) {
        throw new BadRequestException(`L'ambito ${dto.scopeType} richiede di specificare almeno un path.`);
      }
      files = files.filter((f: any) => dto.paths!.some(p => f.path.startsWith(p)));
    }

    // Estraiamo le estensioni uniche
    const detectedLanguages = [...new Set(files
      .map((f: any) => f.path.split('.').pop()?.toLowerCase())
      .filter((ext: string) => ext && this.SUPPORTED_EXTENSIONS.includes(ext))
    )] as string[];

    const estimatedFileCount = files.length;

    // Eseguiamo le asserzioni REALI
    this.assertWithinSizeLimits(estimatedFileCount);
    this.assertSupportedLanguages(detectedLanguages);

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
      sprintId: dto.sprintId,
    });
  }

  private assertSupportedLanguages(languages: string[]) {
    if (!languages || languages.length === 0) {
      throw new BadRequestException('Nessun linguaggio supportato rilevato nell\'ambito selezionato (richiesti: TS, JS o Python).');
    }
  }

  private assertWithinSizeLimits(count: number) {
    if (count > this.MAX_FILES) {
      throw new BadRequestException(`L'ambito selezionato contiene ${count} file, superando il limite di ${this.MAX_FILES}. Riduci l'ambito specificando una cartella.`);
    }
    if (count === 0) {
      throw new BadRequestException('L\'ambito selezionato è vuoto o non contiene file analizzabili.');
    }
  }
}