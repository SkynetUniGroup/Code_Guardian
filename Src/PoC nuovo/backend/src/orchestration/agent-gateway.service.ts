import { Injectable, Logger, RequestTimeoutException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AgentDescriptor } from './agent.registry.js';
import { firstValueFrom, catchError } from 'rxjs';

@Injectable()
export class AgentGatewayService {
  private readonly logger = new Logger(AgentGatewayService.name);

  constructor(private readonly httpService: HttpService) {}

  async invokeAgent(descriptor: AgentDescriptor, payload: any): Promise<any> {
    const baseUrl = 'http://agents:8000';
    const url = `${baseUrl}${descriptor.destinationUrl}`;

    this.logger.log(`Invocazione agente all'URL: ${url}`);
    
    try {
      const response = await firstValueFrom(
        this.httpService.post(url, payload, {
          // Timeout aumentato a 55s per permettere all'agente Python (che ha 45s) 
          // di impacchettare correttamente il report di errore/timeout.
          timeout: 55000, 
        }).pipe(
          catchError((error) => {
            this.logger.error(`Errore HTTP verso l'agente: ${error.message}`);
            throw error;
          })
        )
      );
      return response.data;
    } catch (error: any) {
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        throw new RequestTimeoutException('Timeout dell\'agente (superati i 55 secondi di attesa totale)');
      }
      throw error;
    }
  }
}