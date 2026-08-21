/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ContextController } from './context.controller.js';
import { RepositoryContextService } from '../internal/repository-context.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import type { CreateContextDto } from '../common/dto/context.dto.js';

describe('ContextController', () => {
  let controller: ContextController;
  let mockContextService: { buildContext: jest.Mock };

  beforeEach(async () => {
    mockContextService = { buildContext: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContextController],
      providers: [{ provide: RepositoryContextService, useValue: mockContextService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ContextController>(ContextController);
  });

  it('dovrebbe delegare al servizio e restituire solo il contextId come stringa', async () => {
    mockContextService.buildContext.mockResolvedValue({ _id: { toString: () => 'ctx-generated-1' } });
    const dto: CreateContextDto = { repoOwner: 'acme', repoName: 'demo', ref: 'main', scopeType: 'FULL_REPOSITORY' } as any;

    const result = await controller.createContext(dto, 'user-1');

    expect(mockContextService.buildContext).toHaveBeenCalledWith('user-1', dto);
    expect(result).toEqual({ contextId: 'ctx-generated-1' });
  });

  it('dovrebbe propagare inalterate le eccezioni di validazione sollevate dal servizio', async () => {
    mockContextService.buildContext.mockRejectedValue(new BadRequestException('ambito non valido'));
    const dto: CreateContextDto = { repoOwner: 'acme', repoName: 'demo', ref: 'main', scopeType: 'FILES', paths: [] } as any;

    await expect(controller.createContext(dto, 'user-1')).rejects.toThrow(BadRequestException);
  });
});
