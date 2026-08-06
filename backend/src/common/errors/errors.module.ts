import { Global, Module } from "@nestjs/common";

import { ERROR_REPORTER, NoOpErrorReporter } from "./error-reporter";

@Global()
@Module({
  providers: [{ provide: ERROR_REPORTER, useClass: NoOpErrorReporter }],
  exports: [ERROR_REPORTER],
})
export class ErrorsModule {}
