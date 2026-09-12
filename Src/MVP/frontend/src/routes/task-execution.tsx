import { createRoute } from "@tanstack/react-router";
import TaskExecution from "../pages/TaskExecution";
import { rootRoute } from "./root";

export const taskExecutionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "tasks/$taskId",
  component: TaskExecution,
});
