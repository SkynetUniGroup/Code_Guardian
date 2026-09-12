import { createRoute } from "@tanstack/react-router";
import ReportView from "../pages/ReportView";
import { rootRoute } from "./root";

export const reportViewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "reports/$reportId",
  component: ReportView,
});
