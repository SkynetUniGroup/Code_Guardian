import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-code';

export class AppException extends HttpException {
  readonly code: ErrorCode;

  constructor(
    code: ErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
  ) {
    super(message, status);
    this.code = code;
  }
}
