import { Injectable } from "@nestjs/common";
import { GeoRelationType } from "@prisma/client";

import { PrismaService } from "../../infrastructure/database/prisma.service";
import type { TaxonomyRelation } from "./deck-membership";

/**
 * Where the classification comes from when previewing a taxonomy deck.
 *
 * Most of the region → country hierarchy is derived from pinned upstream
 * sources during a build, so the editorial document alone cannot resolve it.
 * The published `geo_relations` of the active release ARE that merged
 * hierarchy, and the draft's own `additionalRelations` are the editorial
 * additions layered on top — together they are what the next build will
 * classify with, unless a source refresh changes the hierarchy first, which
 * only shows up after the next publish.
 */
@Injectable()
export class TaxonomySourceService {
  constructor(private readonly database: PrismaService) {}

  async publishedRelations(): Promise<TaxonomyRelation[]> {
    const relations = await this.database.geoRelation.findMany({
      where: { relationType: GeoRelationType.CONTAINS },
      select: {
        parent: { select: { contentKey: true } },
        child: { select: { contentKey: true } },
      },
    });
    return relations.map((relation) => ({
      parentKey: relation.parent.contentKey,
      childKey: relation.child.contentKey,
      relationType: "contains",
    }));
  }

  /**
   * Editorial additions win nothing and lose nothing: they are appended,
   * and the walk deduplicates by traversal rather than by pair.
   */
  merge(
    published: TaxonomyRelation[],
    documentRelations: unknown,
  ): TaxonomyRelation[] {
    if (!Array.isArray(documentRelations)) {
      return published;
    }
    const editorial = documentRelations.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return [];
      }
      const record = entry as Record<string, unknown>;
      if (
        typeof record.parentKey !== "string" ||
        typeof record.childKey !== "string" ||
        typeof record.relationType !== "string"
      ) {
        return [];
      }
      return [
        {
          parentKey: record.parentKey,
          childKey: record.childKey,
          relationType: record.relationType,
        },
      ];
    });
    return [...published, ...editorial];
  }
}
