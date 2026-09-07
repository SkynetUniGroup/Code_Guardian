import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ContextsService } from './contexts.service';
import { AnalysisContext } from './schemas/analysis-context.schema';
import { CredentialsService } from '../credentials/credentials.service';
import { GithubClientService } from '../github/github-client.service';
import { RepoResolverService } from './repo-resolver.service';
import { FRANC } from './franc.provider';
import { CreateContextDto } from './dto/create-context.dto';

describe('ContextsService', () => {
  let service: ContextsService;
  let model: {
    create: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
  };
  let credentials: { getDecryptedToken: jest.Mock };
  let repoResolver: { resolve: jest.Mock };
  let franc: jest.Mock<string, [string]>;
  let github: {
    listRefs: jest.Mock;
    compareCommits: jest.Mock;
    getTree: jest.Mock;
    getReadme: jest.Mock;
  };

  const baseDto: CreateContextDto = {
    repoUrl: 'https://github.com/owner/repo',
    branch: 'main',
    scopeType: 'FULL_REPOSITORY',
  };

  const fullTree = [
    { path: 'src', type: 'dir' as const, sizeBytes: 0 },
    { path: 'src/index.ts', type: 'file' as const, sizeBytes: 10 },
    { path: 'src/utils.py', type: 'file' as const, sizeBytes: 10 },
    { path: 'docs', type: 'dir' as const, sizeBytes: 0 },
    { path: 'docs/notes.md', type: 'file' as const, sizeBytes: 10 },
  ];

  function createdDocument(overrides: Record<string, unknown> = {}) {
    return {
      _id: { toString: () => 'ctx1' },
      repoOwner: 'owner',
      repoName: 'repo',
      isPrivate: false,
      branch: 'main',
      resolvedSha: 'branch-head-sha',
      scopeType: 'FULL_REPOSITORY',
      paths: [],
      detectedLanguages: ['typescript', 'python'],
      estimatedFileCount: 3,
      nonEnglishReadmeDetected: false,
      ...overrides,
    };
  }

  beforeEach(async () => {
    model = {
      create: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
    };
    credentials = { getDecryptedToken: jest.fn().mockResolvedValue('token') };
    repoResolver = {
      resolve: jest
        .fn()
        .mockResolvedValue({ owner: 'owner', repo: 'repo', isPrivate: false }),
    };
    github = {
      listRefs: jest.fn().mockResolvedValue({
        branches: [{ name: 'main', sha: 'branch-head-sha' }],
        tags: [],
      }),
      compareCommits: jest.fn(),
      getTree: jest.fn().mockResolvedValue(fullTree),
      getReadme: jest.fn().mockResolvedValue(null),
    };
    // Defaults to 'eng' so every test that doesn't care about RV.8 gets a
    // non-warning result without having to set this up itself.
    franc = jest.fn<string, [string]>().mockReturnValue('eng');
    model.create.mockImplementation((doc: Record<string, unknown>) =>
      Promise.resolve(createdDocument(doc)),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContextsService,
        { provide: getModelToken(AnalysisContext.name), useValue: model },
        { provide: CredentialsService, useValue: credentials },
        { provide: GithubClientService, useValue: github },
        { provide: RepoResolverService, useValue: repoResolver },
        { provide: FRANC, useValue: franc },
      ],
    }).compile();

    service = module.get(ContextsService);
  });

  describe('happy paths', () => {
    it('FULL_REPOSITORY: persists with every file counted and no paths', async () => {
      const result = await service.create('user1', baseDto);

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({
          scopeType: 'FULL_REPOSITORY',
          paths: [],
          resolvedSha: 'branch-head-sha',
          estimatedFileCount: 3, // 3 files in fullTree
        }),
      );
      const createdWith = model.create.mock.calls[0][0] as Record<
        string,
        unknown
      > & { detectedLanguages: string[] };
      expect(createdWith.detectedLanguages.sort()).toEqual([
        'python',
        'typescript',
      ]);
      expect(result.id).toBe('ctx1');
    });

    it('FILES: persists the normalized paths and counts exactly them', async () => {
      await service.create('user1', {
        ...baseDto,
        scopeType: 'FILES',
        paths: ['/src/index.ts', 'src/index.ts', 'docs/notes.md'],
      });

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({
          scopeType: 'FILES',
          paths: ['src/index.ts', 'docs/notes.md'], // deduplicated
          estimatedFileCount: 2,
        }),
      );
    });

    it('DIRECTORIES: counts every file recursively under the selected prefix', async () => {
      await service.create('user1', {
        ...baseDto,
        scopeType: 'DIRECTORIES',
        paths: ['src'],
      });

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({
          scopeType: 'DIRECTORIES',
          paths: ['src'],
          estimatedFileCount: 2, // src/index.ts, src/utils.py
        }),
      );
    });

    it('anchors to the supplied commitSha instead of the branch HEAD when given', async () => {
      github.compareCommits.mockResolvedValue({ status: 'identical' });

      await service.create('user1', { ...baseDto, commitSha: 'pinned-sha' });

      expect(github.compareCommits).toHaveBeenCalledWith(
        'token',
        'owner',
        'repo',
        'pinned-sha',
        'branch-head-sha',
      );
      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ resolvedSha: 'pinned-sha' }),
      );
    });

    it('fetches the tree exactly once, reused by both language detection and scope validation', async () => {
      await service.create('user1', {
        ...baseDto,
        scopeType: 'FILES',
        paths: ['src/index.ts'],
      });

      expect(github.getTree).toHaveBeenCalledTimes(1);
    });
  });

  describe('step 4 — branch existence', () => {
    it('throws NotFoundException when the branch does not exist', async () => {
      github.listRefs.mockResolvedValue({ branches: [], tags: [] });

      await expect(service.create('user1', baseDto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(model.create).not.toHaveBeenCalled();
    });
  });

  describe('step 5 — commit membership', () => {
    it.each(['behind', 'diverged'] as const)(
      'rejects with 422 when compareCommits reports %s',
      async (status) => {
        github.compareCommits.mockResolvedValue({ status });

        await expect(
          service.create('user1', { ...baseDto, commitSha: 'stray-sha' }),
        ).rejects.toBeInstanceOf(UnprocessableEntityException);
        expect(model.create).not.toHaveBeenCalled();
      },
    );

    it('accepts "ahead" as valid membership', async () => {
      github.compareCommits.mockResolvedValue({ status: 'ahead' });

      await expect(
        service.create('user1', { ...baseDto, commitSha: 'ancestor-sha' }),
      ).resolves.toBeDefined();
    });
  });

  describe('step 8 — non-empty scope', () => {
    it('rejects FILES with no paths', async () => {
      await expect(
        service.create('user1', { ...baseDto, scopeType: 'FILES', paths: [] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects paths that normalize away to nothing', async () => {
      await expect(
        service.create('user1', {
          ...baseDto,
          scopeType: 'FILES',
          paths: ['.', '..', '/'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects FULL_REPOSITORY with paths supplied', async () => {
      await expect(
        service.create('user1', {
          ...baseDto,
          scopeType: 'FULL_REPOSITORY',
          paths: ['src'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('step 9 — scope existence', () => {
    it('rejects a path that does not exist in the tree', async () => {
      await expect(
        service.create('user1', {
          ...baseDto,
          scopeType: 'FILES',
          paths: ['nope.ts'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a FILES path that is actually a directory', async () => {
      await expect(
        service.create('user1', {
          ...baseDto,
          scopeType: 'FILES',
          paths: ['src'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a DIRECTORIES path that is actually a file', async () => {
      await expect(
        service.create('user1', {
          ...baseDto,
          scopeType: 'DIRECTORIES',
          paths: ['src/index.ts'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('RV.8 — README language check', () => {
    it('is false when the repo has no README', async () => {
      github.getReadme.mockResolvedValue(null);

      const result = await service.create('user1', baseDto);
      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ nonEnglishReadmeDetected: false }),
      );
      expect(result.nonEnglishReadmeDetected).toBe(false);
    });

    it('is true when franc detects the README as non-English', async () => {
      github.getReadme.mockResolvedValue({
        path: 'README.md',
        content:
          'Questo progetto aiuta gli sviluppatori a gestire le loro attività quotidiane in modo semplice ed efficace.',
        sha: 'readme-sha',
        language: 'unknown',
      });
      franc.mockReturnValue('ita');

      await service.create('user1', baseDto);
      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ nonEnglishReadmeDetected: true }),
      );
    });

    it('does not fail context creation when fetching the README throws', async () => {
      github.getReadme.mockRejectedValue(new Error('network blip'));

      await expect(service.create('user1', baseDto)).resolves.toBeDefined();
    });
  });

  /**
   * TU_22 (RV.7, RF.24) — linguaggi supportati e avviso non bloccante.
   *
   * Corrispondenza PARZIALE, e il motivo è un difetto aperto documentato qui
   * sotto con due `it.failing`: RV.7 (i tre linguaggi supportati passano
   * senza avviso) è verificabile e regge; RF.24 (per ogni altro linguaggio
   * un avviso non bloccante) non è implementato da nessuna parte —
   * `detectLanguage` mappa qualunque estensione fuori da ts/tsx/js/jsx/py su
   * 'unknown' e `detectLanguages` filtra via proprio quel valore, quindi
   * l'informazione da cui l'avviso dovrebbe nascere viene scartata prima di
   * arrivare al contesto. Da non confondere con RV.8, la lingua *naturale*
   * del README, che invece esiste e ha il suo campo dedicato.
   */
  describe('TU_22 (RV.7, RF.24) — linguaggi supportati e avviso non bloccante', () => {
    /** Repository interamente nei tre linguaggi supportati da RV.7. */
    const alberoSupportato = [
      { path: 'src/index.ts', type: 'file' as const, sizeBytes: 10 },
      { path: 'src/App.jsx', type: 'file' as const, sizeBytes: 10 },
      { path: 'scripts/deploy.py', type: 'file' as const, sizeBytes: 10 },
    ];

    /** Repository in un linguaggio fuori dai tre supportati. */
    const alberoNonSupportato = [
      { path: 'cmd', type: 'dir' as const, sizeBytes: 0 },
      { path: 'cmd/main.go', type: 'file' as const, sizeBytes: 10 },
      { path: 'internal/store.go', type: 'file' as const, sizeBytes: 10 },
    ];

    /** Il documento che il servizio ha chiesto di persistere. */
    function persistito(): Record<string, unknown> {
      return model.create.mock.calls[0][0];
    }

    /**
     * I campi booleani accesi nel documento persistito. È il modo in cui
     * questo test guarda "c'è un avviso?" senza fissare il nome di un campo
     * che oggi non esiste: sceglierlo spetta a chi implementerà RF.24.
     */
    function avvisiAccesi(oggetto: Record<string, unknown>): string[] {
      return Object.entries(oggetto)
        .filter(([, valore]) => valore === true)
        .map(([chiave]) => chiave);
    }

    it('RV.7 — TypeScript, JavaScript e Python sono riconosciuti e passano senza avviso', async () => {
      github.getTree.mockResolvedValue(alberoSupportato);

      await service.create('user1', baseDto);

      const documento = persistito();
      expect((documento.detectedLanguages as string[]).sort()).toEqual([
        'javascript',
        'python',
        'typescript',
      ]);
      // Nessun avviso: né quello di RF.24, né quello di RV.8 sul README.
      expect(avvisiAccesi(documento)).toEqual([]);
    });

    it('RF.24 — un linguaggio non supportato non blocca la creazione del contesto', async () => {
      // La metà di RF.24 che il codice rispetta davvero: l'avviso è "non
      // bloccante", e infatti il contesto viene creato e persistito.
      github.getTree.mockResolvedValue(alberoNonSupportato);

      await expect(service.create('user1', baseDto)).resolves.toBeDefined();
      expect(model.create).toHaveBeenCalledTimes(1);
    });

    it.failing(
      'DIFETTO APERTO — il linguaggio di un repository non supportato non arriva nemmeno al contesto',
      async () => {
        // detectLanguage restituisce 'unknown' per .go, e detectLanguages lo
        // filtra: il contesto di un repository interamente scritto in Go
        // risulta con detectedLanguages vuoto, cioè indistinguibile da quello
        // di un repository vuoto. Finché l'informazione viene scartata qui,
        // nessuno strato a valle — backend, API o interfaccia — può ricavare
        // l'avviso di RF.24, perché non c'è più niente da cui ricavarlo.
        github.getTree.mockResolvedValue(alberoNonSupportato);

        await service.create('user1', baseDto);

        expect(persistito().detectedLanguages).not.toEqual([]);
      },
    );

    it.failing(
      "DIFETTO APERTO — la creazione del contesto non emette l'avviso non bloccante di RF.24",
      async () => {
        // L'altra metà di RF.24: l'avviso. AnalysisContext non ha un campo
        // per portarlo (ha solo nonEnglishReadmeDetected, che è RV.8), e
        // ContextsService non ne calcola alcuno.
        github.getTree.mockResolvedValue(alberoNonSupportato);

        const risultato = await service.create('user1', baseDto);

        expect(avvisiAccesi(persistito())).not.toEqual([]);
        expect(
          avvisiAccesi(risultato as unknown as Record<string, unknown>),
        ).not.toEqual([]);
      },
    );
  });
});
