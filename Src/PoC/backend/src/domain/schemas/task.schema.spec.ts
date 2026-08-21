/// <reference types="jest" />
import { Task } from './task.schema.js';
import type { TaskStatus } from '../../common/dto/types.js';

/**
 * Test di unita' puri per la macchina a stati del ciclo di vita della Task
 * (Task.canTransitionTo). Nessuna dipendenza da Mongoose/MongoDB: il metodo
 * opera solo sul campo 'status' dell'istanza.
 */
describe('Task.canTransitionTo (macchina a stati del ciclo di vita)', () => {
  function taskWithStatus(status: TaskStatus): Task {
    const task = new Task();
    task.status = status;
    return task;
  }

  describe('da PENDING', () => {
    it.each<[TaskStatus, boolean]>([
      ['RUNNING', true],
      ['CANCELLED', true],
      ['COMPLETED', false],
      ['FAILED', false],
    ])('PENDING -> %s dovrebbe essere %s', (target, expected) => {
      expect(taskWithStatus('PENDING').canTransitionTo(target)).toBe(expected);
    });
  });

  describe('da RUNNING', () => {
    it.each<[TaskStatus, boolean]>([
      ['COMPLETED', true],
      ['FAILED', true],
      ['CANCELLED', true],
      ['PENDING', false],
    ])('RUNNING -> %s dovrebbe essere %s', (target, expected) => {
      expect(taskWithStatus('RUNNING').canTransitionTo(target)).toBe(expected);
    });
  });

  describe('dagli stati terminali (nessuna transizione permessa)', () => {
    it.each<TaskStatus>(['COMPLETED', 'FAILED', 'CANCELLED'])(
      '%s e\' uno stato terminale: nessuna transizione e\' permessa',
      (terminalStatus) => {
        const task = taskWithStatus(terminalStatus);
        const allTargets: TaskStatus[] = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'];

        for (const target of allTargets) {
          expect(task.canTransitionTo(target)).toBe(false);
        }
      },
    );
  });
});
