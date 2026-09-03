import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { resolveRequestId } from '../http/request-id.js';

type NormalizedError = {
  status: number;
  code: string;
  message: string;
  details?: unknown;
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      throw exception;
    }

    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (res.headersSent) {
      return;
    }

    const err = this.normalize(exception);
    const traceId = resolveRequestId(req);
    res.setHeader('X-Request-ID', traceId);

    if (err.status >= 500) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(
        `${err.message} code=${err.code} method=${req.method} path=${req.url} traceId=${traceId}`,
        stack,
      );
    }

    res.status(err.status).json({
      code: err.code,
      message: err.message,
      details: err.details,
      traceId,
    });
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'object' && response !== null) {
        const body = response as Record<string, unknown>;
        if (Array.isArray(body.message)) {
          return {
            status,
            code: 'VALIDATION.FAILED',
            message: 'Request validation failed.',
            details: body.message,
          };
        }
        return {
          status,
          code: typeof body.code === 'string' ? body.code : this.defaultCodeFor(status),
          message: typeof body.message === 'string' ? body.message : exception.message,
          details: body.details,
        };
      }
      return {
        status,
        code: this.defaultCodeFor(status),
        message: String(response),
      };
    }

    return {
      status: 500,
      code: 'INTERNAL.UNEXPECTED',
      message: 'Something went wrong.',
    };
  }

  private defaultCodeFor(status: number): string {
    switch (status) {
      case 400:
        return 'REQUEST.BAD';
      case 401:
        return 'AUTH.UNAUTHORIZED';
      case 403:
        return 'AUTH.FORBIDDEN';
      case 404:
        return 'RESOURCE.NOT_FOUND';
      case 409:
        return 'RESOURCE.CONFLICT';
      case 413:
        return 'IMPORT.FILE_TOO_LARGE';
      case 422:
        return 'IMPORT.INVALID_CSV';
      case 503:
        return 'SERVICE.UNAVAILABLE';
      default:
        return 'INTERNAL.UNEXPECTED';
    }
  }
}
