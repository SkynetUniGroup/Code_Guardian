import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './root';
import TaskExecution from '../pages/TaskExecution';

export const taskExecutionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'tasks/$taskId',
  component: TaskExecution,
});