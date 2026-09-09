import { createRoute } from "@tanstack/react-router";
import { ReportsPage } from "../pages/ReportsPage";
import { authRoute } from "./_auth";

/**
 * Reports route — /reports (authenticated, no credentials guard)
 *
 * Report history is readable by all authenticated users regardless of
 * credentials state.
 */
export const reportsRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/reports",
  component: ReportsPage,
});
