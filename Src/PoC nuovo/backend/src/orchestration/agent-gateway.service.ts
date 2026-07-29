import { Injectable, Logger, RequestTimeoutException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AgentDescriptor } from './agent.registry.js';
import { firstValueFrom, catchError } from 'rxjs';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AgentGatewayService {
  private readonly logger = new Logger(AgentGatewayService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async invokeAgent(descriptor: AgentDescriptor, payload: any): Promise<any> {
    // Sganciamo l'URL dalla variabile del frontend. Usiamo AGENTS_BASE_URL o il default interno
    const baseUrl = this.configService.get<string>('AGENTS_BASE_URL') || 'http://agents:8000';
    const url = `${baseUrl}${descriptor.destinationUrl}`;

    this.logger.log(`Invocazione agente all'URL: ${url}`);
    
    try {
      const response = await firstValueFrom(
        this.httpService.post(url, payload, {
          // Timeout rigoroso di 5 minuti (RQ.6)
          timeout: 300000, 
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
        throw new RequestTimeoutException('Timeout dell\'agente (superati i 5 minuti)');
      }
      throw error;
    }
  }
}