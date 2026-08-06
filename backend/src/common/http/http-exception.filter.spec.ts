import { ArgumentsHost, HttpStatus, NotFoundException } from "@nestjs/common";

import { ApiException } from "./api.exception";
import { HttpExceptionFilter } from "./http-exception.filter";

function host(request: unknown, response: unknown): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
}

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  status(code: number): MockResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): MockResponse;
}

function mockResponse(): MockResponse {
  const response: MockResponse = {
    statusCode: 0,
    headers: {},
    body: undefined,
    status(code: number): MockResponse {
      response.statusCode = code;
      return response;
    },
    setHeader(name: string, value: string): void {
      response.headers[name] = value;
    },
    json(body: unknown): MockResponse {
      response.body = body;
      return response;
    },
  };
  return response;
}

describe("HttpExceptionFilter", () => {
  it("does not report a deliberately-thrown ApiException, and returns its own code/message", () => {
    const report = jest.fn();
    const recordError = jest.fn();
    const filter = new HttpExceptionFilter(
      { report } as never,
      { recordError } as never,
    );
    const request = { requestId: "req-1", method: "GET", originalUrl: "/v1/x" };
    const response = mockResponse();

    filter.catch(
      new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Missing"),
      host(request, response),
    );

    expect(report).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(404);
    expect(response.body).toMatchObject({
      error: {
        code: "RESOURCE_NOT_FOUND",
        message: "Missing",
        requestId: "req-1",
      },
    });
    expect(recordError).toHaveBeenCalledWith("RESOURCE_NOT_FOUND");
  });

  it("maps a built-in HttpException to the canonical envelope", () => {
    const report = jest.fn();
    const filter = new HttpExceptionFilter(
      { report } as never,
      { recordError: jest.fn() } as never,
    );
    const request = { requestId: "req-2", method: "GET", originalUrl: "/v1/x" };
    const response = mockResponse();

    filter.catch(new NotFoundException("not found"), host(request, response));

    expect(report).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(404);
    expect(response.body).toMatchObject({
      error: { code: "RESOURCE_NOT_FOUND", requestId: "req-2" },
    });
  });

  it("reports an uncaught exception and never leaks its raw message to the client", () => {
    const report = jest.fn();
    const recordError = jest.fn();
    const filter = new HttpExceptionFilter(
      { report } as never,
      { recordError } as never,
    );
    const request = {
      requestId: "req-3",
      method: "POST",
      originalUrl: "/v1/reviews/batch",
    };
    const response = mockResponse();

    filter.catch(
      new Error("connection string contains password=hunter2"),
      host(request, response),
    );

    expect(report).toHaveBeenCalledTimes(1);
    const [reportedError, context] = report.mock.calls[0] as [
      Error,
      Record<string, unknown>,
    ];
    expect(reportedError.message).toContain("password=hunter2");
    expect(context).toMatchObject({ requestId: "req-3" });

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({
      error: { code: "INTERNAL_ERROR", requestId: "req-3" },
    });
    expect(JSON.stringify(response.body)).not.toContain("hunter2");
    expect(recordError).toHaveBeenCalledWith("INTERNAL_ERROR");
  });
});
