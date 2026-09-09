import { createRoute, redirect } from "@tanstack/react-router";
import { LoginPage } from "../pages/LoginPage";
import { rootRoute } from "./root";

/**
 * Login route — /login (public)
 *
 * Redirects authenticated users away to /run so they cannot return to the
 * login page while they have an active session.
 */
export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: ({ context }) => {
    if (context.session.isAuthenticated()) {
      throw redirect({ to: "/run" });
    }
  },
  component: LoginPage,
});
