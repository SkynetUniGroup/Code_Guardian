import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { AppException } from '../exceptions/app.exception';

interface ErrorResponseBody {
  code: string;
  message: string;
  details?: string[];
}

// Fallback codes for NestJS's own built-in exceptions (NotFoundException,
// UnauthorizedException, ForbiddenException, ConflictException, ...) thrown
// directly by future code instead of through AppException. Anything with a
// status not listed here still falls back to INTERNAL_ERROR.
const STATUS_FALLBACK_CODE: Partial<Record<number, string>> = {
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppException) {
      const body: ErrorResponseBody = {
        code: exception.code,
        message: exception.message,
      };
      response.status(exception.getStatus()).json(body);
      return;
    }

    if (exception instanceof BadRequestException) {
      const body: ErrorResponseBody = {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed.',
        details: this.extractValidationDetails(exception),
      };
      response.status(HttpStatus.BAD_REQUEST).json(body);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body: ErrorResponseBody = {
        code: STATUS_FALLBACK_CODE[status] ?? 'INTERNAL_ERROR',
        message: exception.message,
      };
      response.status(status).json(body);
      return;
    }

    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : String(exception),
    );
    const body: ErrorResponseBody = {
      code: 'INTERNAL_ERROR',
      message: 'An internal error occurred.',
    };
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }

  private extractValidationDetails(exception: BadRequestException): string[] {
    const body = exception.getResponse();
    if (
      typeof body === 'object' &&
      body !== null &&
      'message' in body &&
      Array.isArray(body.message)
    ) {
      return (body as { message: string[] }).message;
    }
    return [exception.message];
  }
}
