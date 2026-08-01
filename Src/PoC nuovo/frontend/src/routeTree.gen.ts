import { Route } from '@tanstack/react-router';
import { rootRoute } from './routes/root';
import { repositorySelectionRoute } from './routes/repository-selection';
import { taskExecutionRoute } from './routes/task-execution';
import { reportViewRoute } from './routes/report-view';
import { setupRoute } from './routes/setup'; 

export const routeTree = rootRoute.addChildren([
  setupRoute, 
  repositorySelectionRoute,
  taskExecutionRoute,
  reportViewRoute,
]);