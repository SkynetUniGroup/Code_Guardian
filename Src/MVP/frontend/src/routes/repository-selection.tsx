import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './root';
import RepositorySelection from '../pages/RepositorySelection';

export const repositorySelectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: RepositorySelection,
});