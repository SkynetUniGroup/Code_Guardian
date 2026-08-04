import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './root';
import TasksList from '../pages/TasksList';

export const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'tasks',
  component: TasksList,
});