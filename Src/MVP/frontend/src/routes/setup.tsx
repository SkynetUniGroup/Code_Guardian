import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './root';
import Setup from '../pages/Setup';

export const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  component: Setup,
});