import { createRoute } from '@tanstack/react-router';
import { authRoute } from './_auth';
import { TasksPage } from '../pages/TasksPage';

/**
 * Tasks route — /tasks (authenticated, no credentials guard)
 *
 * All authenticated users can view the task list and their execution status
 * regardless of credentials state. Cancellation requires auth only.
 */
export const tasksRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/tasks',
  component: TasksPage,
});
