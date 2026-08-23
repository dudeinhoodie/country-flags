import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { ApiException } from "../../common/http/api.exception";
import type { EnvironmentVariables } from "../../config/environment.validation";

export interface CatalogSnapshot {
  document: unknown;
  commit: string;
}

/**
 * The deployed backend has no git checkout, so the editorial catalog rides
 * inside the image: it is copied at build time and the commit it belongs to
 * is exactly the deployed release (SERVICE_RELEASE). Locally the default
 * path points straight into the monorepo working tree.
 */
@Injectable()
export class CatalogSourceService {
  constructor(private readonly config: ConfigService<EnvironmentVariables>) {}

  read(): CatalogSnapshot {
    const path = resolve(
      process.cwd(),
      this.config.getOrThrow<string>("ADMIN_CATALOG_PATH"),
    );
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        "CATALOG_SOURCE_UNAVAILABLE",
        "The editorial catalog is not available to this deployment",
      );
    }
    return {
      document: JSON.parse(raw) as unknown,
      commit: this.config.getOrThrow<string>("SERVICE_RELEASE"),
    };
  }
}
