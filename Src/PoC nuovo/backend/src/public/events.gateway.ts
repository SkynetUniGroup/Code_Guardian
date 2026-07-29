import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TaskStatus } from '../common/dto/types';

@Injectable()
@WebSocketGateway({ cors: true })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  handleConnection(client: Socket) {
    const token = this.extractToken(client);
    if (!token) {
      this.logger.warn(`Connessione rifiutata (${client.id}): token mancante`);
      client.disconnect(true);
      return;
    }
    try {
      const payload = this.jwtService.verify(token);
      client.data.userId = payload.sub;
      client.join(`user:${payload.sub}`);
      this.logger.log(`Client autenticato: ${client.id} (user ${payload.sub})`);
    } catch {
      this.logger.warn(`Connessione rifiutata (${client.id}): token non valido`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnesso: ${client.id}`);
  }

  private extractToken(client: Socket): string | null {
    const fromAuth = client.handshake.auth?.token;
    if (fromAuth) return fromAuth;
    const header = client.handshake.headers['authorization'];
    if (header?.startsWith('Bearer ')) return header.slice(7);
    return null;
  }

  emitTaskProgress(taskId: string, stage: string, percent: number, userId?: string) {
    this.emitScoped(userId, 'task.progress', { taskId, stage, percent });
  }

  emitTaskUpdated(taskId: string, status: TaskStatus, reportId?: string, userId?: string) {
    this.emitScoped(userId, 'task.updated', { taskId, status, reportId });
  }

  emitTaskFailed(taskId: string, error: any, userId?: string) {
    this.emitScoped(userId, 'task.failed', { taskId, error });
  }

  emitBatchCompleted(batchId: string, completed: number, failed: number, userId?: string) {
    this.emitScoped(userId, 'batch.completed', { batchId, completed, failed });
  }

  private emitScoped(userId: string | undefined, event: string, payload: any) {
    if (userId) {
      this.server.to(`user:${userId}`).emit(event, payload);
    } else {
      // fallback: nessun userId disponibile, broadcast globale (da evitare)
      this.server.emit(event, payload);
    }
  }
}