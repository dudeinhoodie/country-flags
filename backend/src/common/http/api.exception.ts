import { HttpException, type HttpStatus } from "@nestjs/common";

export class ApiException extends HttpException {
  constructor(
    status: HttpStatus,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(
      {
        error: {
          code,
          message,
          details,
        },
      },
      status,
    );
  }
}
