import { Module } from "@nestjs/common";
import { SonarqubeClientService } from "./sonarqube-client.service";

// Read-only SonarQube/SonarCloud client, used by CredentialsModule to verify
// a SONARQUBE credential before it is stored. Deliberately thin: the metrics
// reading itself lives in the Python agents (agents/src/sonarqube_service.py)
// and runs there with the credential the backend forwards in the agent
// payload — the backend never reads metrics, it only proves the credential
// works and hands it on. No Redis, no state.
@Module({
  providers: [SonarqubeClientService],
  exports: [SonarqubeClientService],
})
export class SonarqubeModule {}
