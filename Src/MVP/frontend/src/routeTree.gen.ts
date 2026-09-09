/**
 * Route tree — manually maintained.
 *
 * Assembles all route definitions into the tree consumed by createRouter().
 * When adding or removing routes, update this file accordingly.
 */

import { authRoute } from "./routes/_auth";
import { credentialsRoute } from "./routes/_auth.credentials";
import { reportsRoute } from "./routes/_auth.reports";
import { reportDetailRoute } from "./routes/_auth.reports.$id";
import { runRoute } from "./routes/_auth.run";
import { selectRoute } from "./routes/_auth.select";
import { tasksRoute } from "./routes/_auth.tasks";
import { indexRoute } from "./routes/index";
import { loginRoute } from "./routes/login";
import { registerRoute } from "./routes/register";
import { rootRoute } from "./routes/root";

/**
 * Authenticated children are nested under authRoute (the pathless layout route).
 * Public routes (login, register) are direct children of the root.
 */
const authenticatedChildren = authRoute.addChildren([
  credentialsRoute,
  selectRoute,
  runRoute,
  tasksRoute,
  reportsRoute,
  reportDetailRoute,
]);

export const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  registerRoute,
  authenticatedChildren,
]);
