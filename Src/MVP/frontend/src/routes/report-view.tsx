import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './root';
import ReportView from '../pages/ReportView';

export const reportViewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'reports/$reportId',
  component: ReportView,
});