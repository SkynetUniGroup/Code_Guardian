import { createRoute, redirect } from "@tanstack/react-router";
import { RunPage } from "../pages/RunPage";
import { authRoute } from "./_auth";

/**
 * Run route — /run (authenticated + credentials required)
 *
 * Launching an operation requires valid credentials. Users with missing or
 * invalid credentials are redirected to /credentials.
 */
export const runRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/run",
  beforeLoad: ({ context }) => {
    // Stessa regola di /select: passa solo CONNECTED. Lo stato iniziale
    // UNKNOWN significa "non ancora verificato", non "va bene".
    if (context.session.credentialsStatus !== "CONNECTED") {
      throw redirect({ to: "/credentials" });
    }
  },
  component: RunPage,
});
