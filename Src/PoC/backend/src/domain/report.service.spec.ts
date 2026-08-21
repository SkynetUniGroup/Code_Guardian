/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ReportService } from './report.service.js';
import { Report } from './schemas/report.schema.js';

describe('ReportService', () => {
  let service: ReportService;
  let mockReportModel: {
    create: jest.Mock;
    findById: jest.Mock;
    findOne: jest.Mock;
    findByIdAndUpdate: jest.Mock;
    find: jest.Mock;
  };

  beforeEach(async () => {
    mockReportModel = {
      create: jest.fn(),
      findById: jest.fn(),
      findOne: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      find: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportService,
        { provide: getModelToken(Report.name), useValue: mockReportModel },
      ],
    }).compile();

    service = module.get<ReportService>(ReportService);
  });

  it('create dovrebbe delegare al modello Mongoose', async () => {
    mockReportModel.create.mockResolvedValue({ _id: 'r1', status: 'COMPLETED' });

    const result = await service.create({ status: 'COMPLETED' } as any);

    expect(mockReportModel.create).toHaveBeenCalledWith({ status: 'COMPLETED' });
    expect(result).toEqual({ _id: 'r1', status: 'COMPLETED' });
  });

  it('findById dovrebbe cercare per id ed eseguire la query', async () => {
    const exec = jest.fn().mockResolvedValue({ _id: 'r1' });
    mockReportModel.findById.mockReturnValue({ exec });

    const result = await service.findById('r1');

    expect(mockReportModel.findById).toHaveBeenCalledWith('r1');
    expect(result).toEqual({ _id: 'r1' });
  });

  it('findByTaskId dovrebbe cercare per taskId', async () => {
    const exec = jest.fn().mockResolvedValue({ _id: 'r1', taskId: 't1' });
    mockReportModel.findOne.mockReturnValue({ exec });

    const result = await service.findByTaskId('t1');

    expect(mockReportModel.findOne).toHaveBeenCalledWith({ taskId: 't1' });
    expect(result).toEqual({ _id: 'r1', taskId: 't1' });
  });

  it('updateStatus dovrebbe aggiornare solo il campo status e restituire il documento aggiornato', async () => {
    const exec = jest.fn().mockResolvedValue({ _id: 'r1', status: 'FAILED' });
    mockReportModel.findByIdAndUpdate.mockReturnValue({ exec });

    const result = await service.updateStatus('r1', 'FAILED');

    expect(mockReportModel.findByIdAndUpdate).toHaveBeenCalledWith('r1', { status: 'FAILED' }, { new: true });
    expect(result).toEqual({ _id: 'r1', status: 'FAILED' });
  });

  it('update dovrebbe applicare un aggiornamento parziale arbitrario', async () => {
    const exec = jest.fn().mockResolvedValue({ _id: 'r1', summary: 'aggiornato' });
    mockReportModel.findByIdAndUpdate.mockReturnValue({ exec });

    const result = await service.update('r1', { summary: 'aggiornato' });

    expect(mockReportModel.findByIdAndUpdate).toHaveBeenCalledWith('r1', { summary: 'aggiornato' }, { new: true });
    expect(result).toEqual({ _id: 'r1', summary: 'aggiornato' });
  });

  it('findAll dovrebbe restituire tutti i report', async () => {
    const exec = jest.fn().mockResolvedValue([{ _id: 'r1' }, { _id: 'r2' }]);
    mockReportModel.find.mockReturnValue({ exec });

    const result = await service.findAll();

    expect(result).toEqual([{ _id: 'r1' }, { _id: 'r2' }]);
  });
});
