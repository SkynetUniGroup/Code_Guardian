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
    // Passa solo CONNECTED, non "tutto tranne MISSING e INVALID".
    //
    // Lo stato nasce UNKNOWN e lo imposta soltanto CredentialsPage: un utente
    // appena registrato, che quella pagina non l'ha mai aperta, arrivava qui
    // con UNKNOWN e la guardia lo lasciava passare. Atterrava su /select senza
    // PAT, dove l'elenco dei repository non puo' che fallire.
    //
    // UNKNOWN vuol dire "non ancora verificato", e il posto dove si verifica e'
    // /credentials. Mandarcelo non costa nulla: la sessione non e' persistita
    // (vedi sessionStore), quindi dopo un ricaricamento non si e' comunque piu'
    // autenticati e si ripassa dal login.
    if (context.session.credentialsStatus !== "CONNECTED") {
      throw redirect({ to: "/credentials" });
    }
  },
  component: SelectPage,
});
