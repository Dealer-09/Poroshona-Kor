import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();

    const httpStatus =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const response =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    // If response is an object (like NestJS default errors), extract the 'message' string
    const errorMessage = 
      typeof response === 'object' && response !== null && 'message' in response
        ? (response as any).message
        : response;

    // Log the error centrally to prevent silent backend crashes
    this.logger.error(
      `Exception caught: ${
        exception instanceof Error ? exception.message : 'Unknown error'
      }`,
      exception instanceof Error ? exception.stack : '',
    );

    const responseBody = {
      statusCode: httpStatus,
      timestamp: new Date().toISOString(),
      path: httpAdapter.getRequestUrl(ctx.getRequest()) as string,
      message: errorMessage,
    };

    httpAdapter.reply(ctx.getResponse(), responseBody, httpStatus);
  }
}
