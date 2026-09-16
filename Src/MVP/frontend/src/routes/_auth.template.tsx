import { createRoute, redirect } from "@tanstack/react-router";
import { TemplatePage } from "../pages/TemplatePage";
import { authRoute } from "./_auth";

/**
 * Template route — /template (authenticated, Developer only)
 *
 * RF.79-RF.81: gestione del template README personalizzato. Come le
 * credenziali, è una risorsa personale dell'utente e non dipende dal
 * repository selezionato, quindi vive fuori dal flusso di analisi.
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
