import { createRoute, redirect } from "@tanstack/react-router";
import { TemplatePage } from "../pages/TemplatePage";
import { authRoute } from "./_auth";

/**
 * Template route — /template (authenticated, Developer only)
 *
 * RF.79-RF.81: management of the custom README template. Like credentials,
 * it is a personal resource of the user and does not depend on the selected
 * repository, so it lives outside the analysis flow.
 */
export const templateRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/template",
  beforeLoad: ({ context }) => {
    if (context.session.user?.role !== "DEVELOPER") {
      throw redirect({ to: "/run" });
    }
  },
  component: TemplatePage,
});
