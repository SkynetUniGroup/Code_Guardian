import { createRoute } from "@tanstack/react-router";
import { TasksPage } from "../pages/TasksPage";
import { authRoute } from "./_auth";

/**
 * Tasks route — /tasks (authenticated, no credentials guard)
 *
 * All authenticated users can view the task list and their execution status
 * regardless of credentials state. Cancellation requires auth only.
 */
export const tasksRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/tasks",
  component: TasksPage,
});
