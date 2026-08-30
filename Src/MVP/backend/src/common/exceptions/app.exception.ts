import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorKind } from './error-kind';

export class AppException extends HttpException {
  readonly code: ErrorKind;

  constructor(
    code: ErrorKind,
    message: string,
    status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
  ) {
    super(message, status);
    this.code = code;
  }
}
