import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import type { Request, Response } from 'express';

interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

/**
 * Global exception filter producing the standardized error response shape
 * required by rules/backend.md for every error response the API returns:
 *
 * { statusCode, error, message, path, timestamp }
 *
 * Handles both Nest `HttpException`s (validation errors, guard rejections,
 * etc.) and any unexpected thrown error, which is mapped to a generic 500
 * without leaking internals (message, stack trace) to the client.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, error, message } =
      this.resolveExceptionDetails(exception);

    const body: ErrorResponseBody = {
      statusCode,
      error,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(statusCode).json(body);
  }

  private resolveExceptionDetails(exception: unknown): {
    statusCode: number;
    error: string;
    message: string | string[];
  } {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const response = exception.getResponse();

      if (typeof response === 'string') {
        return {
          statusCode,
          error: this.reasonPhrase(statusCode),
          message: response,
        };
      }

      if (this.isRecord(response)) {
        const message = response.message;
        const error = response.error;
        return {
          statusCode,
          error:
            typeof error === 'string' ? error : this.reasonPhrase(statusCode),
          message:
            typeof message === 'string' || Array.isArray(message)
              ? (message as string | string[])
              : exception.message,
        };
      }

      return {
        statusCode,
        error: this.reasonPhrase(statusCode),
        message: exception.message,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: this.reasonPhrase(HttpStatus.INTERNAL_SERVER_ERROR),
      message: 'Internal server error',
    };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private reasonPhrase(statusCode: number): string {
    return STATUS_CODES[statusCode] ?? 'Error';
  }
}
