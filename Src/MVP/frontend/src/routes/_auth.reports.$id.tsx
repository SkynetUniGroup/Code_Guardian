import { createRoute } from "@tanstack/react-router";
import { ReportDetailPage } from "../pages/ReportDetailPage";
import { authRoute } from "./_auth";

/**
 * Report detail route — /reports/:id (authenticated, no credentials guard)
 *
 * Viewing a report requires authentication only; credentials status is
 * irrelevant because reports are stored on the backend, not fetched via
 * GitHub/OpenAI at view time.
 */
export const reportDetailRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/reports/$id",
  component: ReportDetailPage,
});
