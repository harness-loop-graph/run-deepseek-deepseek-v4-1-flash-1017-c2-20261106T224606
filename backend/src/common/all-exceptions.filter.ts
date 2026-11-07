import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppError, ErrorCode } from './errors';

interface ErrorEnvelope {
  error: { code: ErrorCode | string; message: string };
}

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'invalid_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  422: 'validation_error',
  429: 'rate_limited',
};

function codeForStatus(status: number): ErrorCode {
  return STATUS_TO_CODE[status] ?? 'internal_error';
}

/**
 * Body-parser failures are rethrown by the framework as plain `400` exceptions
 * whose message quotes the offending JSON fragment. Those are never echoed.
 */
const PARSER_MESSAGE = /JSON at position|Unexpected token|Expected property name|Unexpected end of JSON|in JSON/i;

function sanitizeMessage(message: string): string {
  if (PARSER_MESSAGE.test(message)) {
    return 'Malformed JSON body';
  }
  // Defensive: never leak stack traces, SQL or filesystem paths (RF-16).
  const forbiddenPatterns = [
    /at\s+\w+\s+\(.*:\d+:\d+\)/,
    /\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+/,
    /\bselect\b[\s\S]*\bfrom\b/i,
    /\binsert\b[\s\S]*\binto\b/i,
    /\bpg_[a-z_]+\b/,
  ];
  if (forbiddenPatterns.some((pattern) => pattern.test(message))) {
    return 'Request could not be processed';
  }
  return message;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppError) {
      const status = exception.getStatus();
      if (exception.retryAfterSeconds !== undefined) {
        response.setHeader('Retry-After', String(exception.retryAfterSeconds));
      }
      const payload: ErrorEnvelope = {
        error: { code: exception.code, message: sanitizeMessage(exception.message) },
      };
      response.status(status).json(payload);
      return;
    }

    // Body-parser failures carry the raw parser message, which includes source
    // positions. Answer with a fixed message instead (RF-16).
    const parserType = (exception as { type?: unknown } | null)?.type;
    if (typeof parserType === 'string' && parserType.length > 0) {
      const tooLarge = parserType === 'entity.too.large';
      const unsupported = parserType.startsWith('charset.') || parserType.startsWith('encoding.');
      response
        .status(
          tooLarge
            ? HttpStatus.PAYLOAD_TOO_LARGE
            : unsupported
              ? HttpStatus.UNSUPPORTED_MEDIA_TYPE
              : HttpStatus.BAD_REQUEST,
        )
        .json({
          error: {
            code: tooLarge
              ? 'payload_too_large'
              : unsupported
                ? 'unsupported_media_type'
                : 'invalid_request',
            message: tooLarge
              ? 'Request body is too large'
              : unsupported
                ? 'Request body encoding is not supported'
                : 'Malformed JSON body',
          },
        } satisfies ErrorEnvelope);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      let message = exception.message;
      if (typeof body === 'string') {
        message = body;
      } else if (body !== null && typeof body === 'object') {
        const candidate = (body as { message?: unknown }).message;
        if (Array.isArray(candidate)) {
          message = candidate.join('; ');
        } else if (typeof candidate === 'string') {
          message = candidate;
        }
      }
      const payload: ErrorEnvelope = {
        error: { code: codeForStatus(status), message: sanitizeMessage(message) },
      };
      response.status(status).json(payload);
      return;
    }

    const multerCode = (exception as { code?: string } | null)?.code;
    if (multerCode === 'LIMIT_FILE_SIZE') {
      response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
        error: { code: 'payload_too_large', message: 'File exceeds the 5 MB limit' },
      } satisfies ErrorEnvelope);
      return;
    }

    this.logger.error(
      `Unhandled exception: ${exception instanceof Error ? exception.message : String(exception)}`,
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'internal_error', message: 'Internal server error' },
    } satisfies ErrorEnvelope);
  }
}
