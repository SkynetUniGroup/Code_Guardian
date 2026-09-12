import { createRoute } from "@tanstack/react-router";
import RepositorySelection from "../pages/RepositorySelection";
import { rootRoute } from "./root";

export const repositorySelectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: RepositorySelection,
});
