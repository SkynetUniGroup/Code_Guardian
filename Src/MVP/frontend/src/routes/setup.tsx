import { createRoute } from "@tanstack/react-router";
import Setup from "../pages/Setup";
import { rootRoute } from "./root";

export const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  component: Setup,
});
