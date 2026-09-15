import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AdminRole } from "@prisma/client";

import type { EnvironmentVariables } from "../../config/environment.validation";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard";
import type { AdminAuthenticatedRequest } from "../admin-auth/admin-auth.guard";
import { assertTrustedAdminOrigin } from "../admin-auth/admin-origin";
import { RequireAdminRole } from "../admin-auth/admin-roles";
import { AdminRolesGuard } from "../admin-auth/admin-roles.guard";
import {
  parseCreateRequest,
  parseLocale,
  parsePreviewRequest,
  parsePublishRequest,
  parseRestoreRequest,
  parseSlug,
  parseUpdateRequest,
  parseVersionNumber,
} from "./admin-site.request";
import {
  toDocumentDetail,
  toDocumentSummary,
  toVersionDetail,
  toVersionSummary,
} from "./admin-site.response";
import { AdminSiteService } from "./admin-site.service";
import type { SiteStatus } from "./admin-site.service";

/**
 * The site's documents (ADR-023). Reads for every admin; drafting needs
 * EDITOR, putting text in front of the public needs PUBLISHER, and taking a
 * document out of existence needs ADMIN. Every mutation is checked against
 * the console's origin, like every other admin write.
 */
@Controller("admin/site")
@UseGuards(AdminAuthGuard, AdminRolesGuard)
export class AdminSiteController {
  constructor(
    private readonly site: AdminSiteService,
    private readonly config: ConfigService<EnvironmentVariables>,
  ) {}

  @Get("status")
  status(): Promise<SiteStatus> {
    return this.site.status();
  }

  @Get("documents")
  async list(): Promise<Record<string, unknown>> {
    const documents = await this.site.list();
    return { items: documents.map(toDocumentSummary) };
  }

  @Post("documents")
  @HttpCode(HttpStatus.CREATED)
  @RequireAdminRole(AdminRole.EDITOR)
  async create(
    @Req() request: AdminAuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    this.assertTrustedOrigin(request);
    const created = await this.site.create(
      request.adminUser,
      parseCreateRequest(body),
      request.requestId,
    );
    return toDocumentDetail(created);
  }

  @Post("documents/preview")
  @HttpCode(HttpStatus.OK)
  @RequireAdminRole(AdminRole.EDITOR)
  preview(
    @Req() request: AdminAuthenticatedRequest,
    @Body() body: unknown,
  ): Record<string, unknown> {
    this.assertTrustedOrigin(request);
    return { html: this.site.preview(parsePreviewRequest(body).body) };
  }

  @Get("documents/:slug/:locale")
  async get(
    @Param("slug") rawSlug: string,
    @Param("locale") rawLocale: string,
  ): Promise<Record<string, unknown>> {
    const document = await this.site.get(
      parseSlug(rawSlug),
      parseLocale(rawLocale),
    );
    return toDocumentDetail(document);
  }

  @Patch("documents/:slug/:locale")
  @RequireAdminRole(AdminRole.EDITOR)
  async update(
    @Req() request: AdminAuthenticatedRequest,
    @Param("slug") rawSlug: string,
    @Param("locale") rawLocale: string,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    this.assertTrustedOrigin(request);
    const updated = await this.site.update(
      request.adminUser,
      parseSlug(rawSlug),
      parseLocale(rawLocale),
      parseUpdateRequest(body),
      request.requestId,
    );
    return toDocumentDetail(updated);
  }

  @Delete("documents/:slug/:locale")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireAdminRole(AdminRole.ADMIN)
  async delete(
    @Req() request: AdminAuthenticatedRequest,
    @Param("slug") rawSlug: string,
    @Param("locale") rawLocale: string,
  ): Promise<void> {
    this.assertTrustedOrigin(request);
    await this.site.delete(
      request.adminUser,
      parseSlug(rawSlug),
      parseLocale(rawLocale),
      request.requestId,
    );
  }

  @Post("documents/:slug/:locale/publish")
  @HttpCode(HttpStatus.OK)
  @RequireAdminRole(AdminRole.PUBLISHER)
  async publish(
    @Req() request: AdminAuthenticatedRequest,
    @Param("slug") rawSlug: string,
    @Param("locale") rawLocale: string,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    this.assertTrustedOrigin(request);
    const published = await this.site.publish(
      request.adminUser,
      parseSlug(rawSlug),
      parseLocale(rawLocale),
      parsePublishRequest(body),
      request.requestId,
    );
    return toDocumentDetail(published);
  }

  @Post("documents/:slug/:locale/unpublish")
  @HttpCode(HttpStatus.OK)
  @RequireAdminRole(AdminRole.PUBLISHER)
  async unpublish(
    @Req() request: AdminAuthenticatedRequest,
    @Param("slug") rawSlug: string,
    @Param("locale") rawLocale: string,
  ): Promise<Record<string, unknown>> {
    this.assertTrustedOrigin(request);
    const document = await this.site.unpublish(
      request.adminUser,
      parseSlug(rawSlug),
      parseLocale(rawLocale),
      request.requestId,
    );
    return toDocumentDetail(document);
  }

  @Get("documents/:slug/:locale/versions")
  async listVersions(
    @Param("slug") rawSlug: string,
    @Param("locale") rawLocale: string,
  ): Promise<Record<string, unknown>> {
    const { versions, currentId } = await this.site.listVersions(
      parseSlug(rawSlug),
      parseLocale(rawLocale),
    );
    return {
      items: versions.map((version) =>
        toVersionSummary(version, version.id === currentId),
      ),
    };
  }

  @Get("documents/:slug/:locale/versions/:version")
  async getVersion(
    @Param("slug") rawSlug: string,
    @Param("locale") rawLocale: string,
    @Param("version") rawVersion: string,
  ): Promise<Record<string, unknown>> {
    const version = await this.site.getVersion(
      parseSlug(rawSlug),
      parseLocale(rawLocale),
      parseVersionNumber(rawVersion),
    );
    return toVersionDetail(version, version.current);
  }

  @Post("documents/:slug/:locale/versions/:version/restore")
  @HttpCode(HttpStatus.OK)
  @RequireAdminRole(AdminRole.EDITOR)
  async restore(
    @Req() request: AdminAuthenticatedRequest,
    @Param("slug") rawSlug: string,
    @Param("locale") rawLocale: string,
    @Param("version") rawVersion: string,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    this.assertTrustedOrigin(request);
    const restored = await this.site.restore(
      request.adminUser,
      parseSlug(rawSlug),
      parseLocale(rawLocale),
      parseVersionNumber(rawVersion),
      parseRestoreRequest(body).revision,
      request.requestId,
    );
    return toDocumentDetail(restored);
  }

  private assertTrustedOrigin(request: AdminAuthenticatedRequest): void {
    assertTrustedAdminOrigin(
      request,
      this.config.getOrThrow<string[]>("ADMIN_ALLOWED_ORIGINS"),
    );
  }
}
