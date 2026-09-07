import { createRoute } from '@tanstack/react-router';
import { authRoute } from './_auth';
import { ReportDetailPage } from '../pages/ReportDetailPage';

/**
 * Report detail route — /reports/:id (authenticated, no credentials guard)
 *
 * Viewing a report requires authentication only; credentials status is
 * irrelevant because reports are stored on the backend, not fetched via
 * GitHub/OpenAI at view time.
 */
export const reportDetailRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/reports/$id',
  component: ReportDetailPage,
});
