import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { TaskProcessor } from './task-processor';
import { Task } from './schemas/task.schema';
import { EventsGateway } from '../events/events.gateway';
import { AgentInvocationService } from './agent-invocation.service';
import { AgentRegistry } from '../operations/agent-registry.service';
import { ReportAssemblyService } from '../reports/report-assembly.service';

describe('TaskProcessor', () => {
  let processor: TaskProcessor;
  let taskModel: { findById: jest.Mock; countDocuments: jest.Mock };
  let events: {
    emitTaskUpdated: jest.Mock;
    emitTaskFailed: jest.Mock;
    emitTaskInputRequired: jest.Mock;
    emitBatchCompleted: jest.Mock;
  };
  let agentInvocation: { invoke: jest.Mock; resume: jest.Mock };
  let agentRegistry: { getAgent: jest.Mock };
  let reportAssembly: {
    assembleCompleted: jest.Mock;
    assembleFailed: jest.Mock;
  };

  function makeTask(overrides: Record<string, unknown> = {}) {
    return {
      id: 'task1',
      userId: 'user1',
      batchId: 'batchA',
      operation: 'DOCS_README',
      status: 'PENDING',
      error: null,
      reportId: null,
      pendingInput: null,
      sprintId: undefined,
      accumulatedMs: 0,
      canTransitionTo: jest.fn().mockReturnValue(true),
      save: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  beforeEach(async () => {
    taskModel = { findById: jest.fn(), countDocuments: jest.fn() };
    events = {
      emitTaskUpdated: jest.fn(),
      emitTaskFailed: jest.fn(),
      emitTaskInputRequired: jest.fn(),
      emitBatchCompleted: jest.fn(),
    };
    agentInvocation = { invoke: jest.fn(), resume: jest.fn() };
    // DOCS by default — most tests don't care about the Changelog/sprintId
    // pre-check, only the ones under 'BE-17 pause/resume' below do, and they
    // override this per-test.
    agentRegistry = { getAgent: jest.fn().mockReturnValue('DOCS') };
    reportAssembly = {
      assembleCompleted: jest.fn().mockResolvedValue({ _id: 'report1' }),
      assembleFailed: jest.fn().mockResolvedValue({ _id: 'report1' }),
    };
    // No other task left active in the batch, by default — most tests only
    // care about the single task's own transition, not the batch tally.
    taskModel.countDocuments.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskProcessor,
        { provide: getModelToken(Task.name), useValue: taskModel },
        { provide: EventsGateway, useValue: events },
        { provide: AgentInvocationService, useValue: agentInvocation },
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: ReportAssemblyService, useValue: reportAssembly },
      ],
    }).compile();

    processor = module.get(TaskProcessor);
  });

  function job(
    data: { taskId: string; inputValue?: unknown } = { taskId: 'task1' },
  ) {
    return { data } as never;
  }

  it('does nothing if the Task no longer exists', async () => {
    taskModel.findById.mockResolvedValue(null);

    await processor.process(job());

    expect(events.emitTaskUpdated).not.toHaveBeenCalled();
  });

  it('skips a Task that was cancelled before the worker picked it up', async () => {
    const task = makeTask({
      status: 'CANCELLED',
      canTransitionTo: jest.fn().mockReturnValue(false),
    });
    taskModel.findById.mockResolvedValue(task);

    await processor.process(job());

    expect(task.save).not.toHaveBeenCalled();
    expect(events.emitTaskUpdated).not.toHaveBeenCalled();
    expect(agentInvocation.invoke).not.toHaveBeenCalled();
  });

  it('transitions PENDING to RUNNING and emits task.updated before invoking the agent', async () => {
    const task = makeTask();
    taskModel.findById.mockResolvedValue(task);
    agentInvocation.invoke.mockResolvedValue({
      status: 'COMPLETED',
      payload: { body: [] },
    });

    await processor.process(job());

    expect(events.emitTaskUpdated).toHaveBeenCalledWith(
      'user1',
      'task1',
      'RUNNING',
    );
  });

  describe('BE-18 report assembly', () => {
    it('assembles and persists a Report on COMPLETED, and includes its id in task.updated', async () => {
      const task = makeTask();
      taskModel.findById.mockResolvedValue(task);
      const payload = { body: [{ kind: 'TEXT', markdown: 'hi' }] };
      agentInvocation.invoke.mockResolvedValue({
        status: 'COMPLETED',
        payload,
      });

      await processor.process(job());

      expect(reportAssembly.assembleCompleted).toHaveBeenCalledWith(
        task,
        payload,
      );
      expect(task.reportId).toBe('report1');
      expect(task.status).toBe('COMPLETED');
      expect(events.emitTaskUpdated).toHaveBeenCalledWith(
        'user1',
        'task1',
        'COMPLETED',
        'report1',
      );
    });

    it('assembles and persists a Report on FAILED, and includes its id on the Task even though the event does not carry it', async () => {
      const task = makeTask();
      taskModel.findById.mockResolvedValue(task);
      const error = {
        code: 'UPSTREAM' as const,
        message: 'boom',
        stage: 'EXECUTION',
      };
      agentInvocation.invoke.mockResolvedValue({ status: 'FAILED', error });

      await processor.process(job());

      expect(reportAssembly.assembleFailed).toHaveBeenCalledWith(task, error);
      expect(task.reportId).toBe('report1');
      expect(task.status).toBe('FAILED');
      expect(events.emitTaskFailed).toHaveBeenCalledWith(
        'user1',
        'task1',
        error,
      );
    });

    it('synthesizes a generic error and still assembles a Report if a FAILED result carries none', async () => {
      const task = makeTask();
      taskModel.findById.mockResolvedValue(task);
      agentInvocation.invoke.mockResolvedValue({ status: 'FAILED' });

      await processor.process(job());

      expect(task.error).toMatchObject({ code: 'UPSTREAM' });
      expect(reportAssembly.assembleFailed).toHaveBeenCalledWith(
        task,
        expect.objectContaining({ code: 'UPSTREAM' }),
      );
    });

    it('assembles a FAILED Report even when the invocation throws, without letting the error escape', async () => {
      const task = makeTask();
      taskModel.findById.mockResolvedValue(task);
      agentInvocation.invoke.mockRejectedValue(new Error('network down'));

      await expect(processor.process(job())).resolves.toBeUndefined();

      expect(task.status).toBe('FAILED');
      expect(task.error).toMatchObject({
        code: 'UPSTREAM',
        message: 'network down',
      });
      expect(reportAssembly.assembleFailed).toHaveBeenCalledWith(
        task,
        expect.objectContaining({ message: 'network down' }),
      );
      expect(events.emitTaskFailed).toHaveBeenCalled();
    });

    it('accumulates machine time across the call and never resets it', async () => {
      const task = makeTask({ accumulatedMs: 1000 });
      taskModel.findById.mockResolvedValue(task);
      const dateSpy = jest
        .spyOn(Date, 'now')
        .mockReturnValueOnce(5000) // startedAt
        .mockReturnValueOnce(5300); // after the (mocked, instant) invoke
      agentInvocation.invoke.mockResolvedValue({
        status: 'COMPLETED',
        payload: { body: [] },
      });

      await processor.process(job());

      expect(task.accumulatedMs).toBe(1300); // 1000 already there + 300 this call
      dateSpy.mockRestore();
    });
  });

  it('does not emit batch.completed while sibling Tasks in the batch are still active', async () => {
    const task = makeTask();
    taskModel.findById.mockResolvedValue(task);
    agentInvocation.invoke.mockResolvedValue({ status: 'FAILED', error: {} });
    taskModel.countDocuments.mockResolvedValueOnce(2); // still active

    await processor.process(job());

    expect(events.emitBatchCompleted).not.toHaveBeenCalled();
  });

  it('emits batch.completed with the tally once no sibling Task is still active', async () => {
    const task = makeTask();
    taskModel.findById.mockResolvedValue(task);
    agentInvocation.invoke.mockResolvedValue({
      status: 'COMPLETED',
      payload: { body: [] },
    });
    taskModel.countDocuments
      .mockResolvedValueOnce(0) // none PENDING/RUNNING
      .mockResolvedValueOnce(3) // COMPLETED
      .mockResolvedValueOnce(1); // FAILED/CANCELLED

    await processor.process(job());

    expect(events.emitBatchCompleted).toHaveBeenCalledWith(
      'user1',
      'batchA',
      3,
      1,
    );
  });

  describe('BE-17 pause/resume', () => {
    it('pauses a fresh Changelog Task on SPRINT_ID without ever calling the agent', async () => {
      const task = makeTask({ operation: 'CHANGELOG_TECHNICAL' });
      taskModel.findById.mockResolvedValue(task);
      agentRegistry.getAgent.mockReturnValue('CHANGELOG');

      await processor.process(job());

      expect(agentInvocation.invoke).not.toHaveBeenCalled();
      expect(task.status).toBe('RUNNING'); // set by the PENDING transition, never overwritten
      expect(task.pendingInput).toEqual({ kind: 'SPRINT_ID' });
      expect(events.emitTaskInputRequired).toHaveBeenCalledWith(
        'user1',
        'task1',
        { kind: 'SPRINT_ID' },
      );
      expect(events.emitTaskFailed).not.toHaveBeenCalled();
    });

    it('invokes the agent for a Changelog Task once sprintId is already set', async () => {
      const task = makeTask({
        operation: 'CHANGELOG_TECHNICAL',
        sprintId: 'S-12',
      });
      taskModel.findById.mockResolvedValue(task);
      agentRegistry.getAgent.mockReturnValue('CHANGELOG');
      agentInvocation.invoke.mockResolvedValue({
        status: 'COMPLETED',
        payload: { body: [] },
      });

      await processor.process(job());

      expect(agentInvocation.invoke).toHaveBeenCalledWith(task);
    });

    it('proceeds straight to invoke() for a Changelog Task already RUNNING with sprintId just answered, without re-emitting task.updated RUNNING', async () => {
      // Simulates the second 'run-task' delivery, after TasksService.submitInput
      // set sprintId and cleared pendingInput but left status RUNNING.
      const task = makeTask({
        operation: 'CHANGELOG_TECHNICAL',
        status: 'RUNNING',
        sprintId: 'S-12',
      });
      taskModel.findById.mockResolvedValue(task);
      agentRegistry.getAgent.mockReturnValue('CHANGELOG');
      agentInvocation.invoke.mockResolvedValue({
        status: 'COMPLETED',
        payload: { body: [] },
      });

      await processor.process(job());

      expect(agentInvocation.invoke).toHaveBeenCalledWith(task);
      expect(events.emitTaskUpdated).toHaveBeenCalledTimes(1); // only the COMPLETED one, no RUNNING re-emit
      expect(events.emitTaskUpdated).toHaveBeenCalledWith(
        'user1',
        'task1',
        'COMPLETED',
        'report1',
      );
    });

    it('sets pendingInput and emits task.inputRequired when the agent itself reports INTERRUPTED', async () => {
      const task = makeTask();
      taskModel.findById.mockResolvedValue(task);
      const pendingInput = {
        kind: 'INCOMPLETE_TASKS' as const,
        taskIds: ['T-1'],
      };
      agentInvocation.invoke.mockResolvedValue({
        status: 'INTERRUPTED',
        pendingInput,
      });

      await processor.process(job());

      expect(task.status).toBe('RUNNING');
      expect(task.pendingInput).toEqual(pendingInput);
      expect(events.emitTaskInputRequired).toHaveBeenCalledWith(
        'user1',
        'task1',
        pendingInput,
      );
      expect(task.save).toHaveBeenCalled();
      expect(reportAssembly.assembleCompleted).not.toHaveBeenCalled();
      expect(reportAssembly.assembleFailed).not.toHaveBeenCalled();
    });

    it('routes a job carrying inputValue to agentInvocation.resume(), not invoke()', async () => {
      const task = makeTask({ status: 'RUNNING' });
      taskModel.findById.mockResolvedValue(task);
      agentInvocation.resume.mockResolvedValue({
        status: 'COMPLETED',
        payload: { body: [] },
      });

      await processor.process(
        job({ taskId: 'task1', inputValue: { action: 'PROCEED' } }),
      );

      expect(agentInvocation.resume).toHaveBeenCalledWith(task, {
        action: 'PROCEED',
      });
      expect(agentInvocation.invoke).not.toHaveBeenCalled();
    });

    it('skips a resume-task job for a Task that is no longer RUNNING (e.g. cancelled meanwhile)', async () => {
      const task = makeTask({ status: 'CANCELLED' });
      taskModel.findById.mockResolvedValue(task);

      await processor.process(
        job({ taskId: 'task1', inputValue: { action: 'PROCEED' } }),
      );

      expect(agentInvocation.resume).not.toHaveBeenCalled();
      expect(task.save).not.toHaveBeenCalled();
    });

    it('does not transition or re-emit task.updated RUNNING for a resume-task job on an already-RUNNING Task', async () => {
      const task = makeTask({ status: 'RUNNING' });
      taskModel.findById.mockResolvedValue(task);
      agentInvocation.resume.mockResolvedValue({ status: 'FAILED', error: {} });

      await processor.process(
        job({ taskId: 'task1', inputValue: { action: 'PROCEED' } }),
      );

      expect(events.emitTaskUpdated).not.toHaveBeenCalled();
    });
  });
});
