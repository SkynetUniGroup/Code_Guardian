import { createRoute, redirect } from "@tanstack/react-router";
import { SelectPage } from "../pages/SelectPage";
import { authRoute } from "./_auth";

/**
 * Select route — /select (authenticated + credentials required)
 *
 * Selecting a repository and configuring the analysis context requires valid
 * credentials (the backend needs the GitHub PAT to list repositories).
 * Users with missing or invalid credentials are redirected to /credentials.
 */
export const selectRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/select",
  beforeLoad: ({ context }) => {
    const status = context.session.credentialsStatus;
    if (status === "missing" || status === "invalid") {
      throw redirect({ to: "/credentials" });
    }
  },
  component: SelectPage,
});
