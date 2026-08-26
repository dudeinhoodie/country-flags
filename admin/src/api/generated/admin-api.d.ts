// Generated from contracts/dist/admin-openapi.bundle.yaml.
// Do not edit by hand: run `corepack yarn admin:api:generate` at the repository root.
export interface paths {
    "/v1/admin/content/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the active release status */
        get: operations["adminGetContentStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/content/entities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List published entities */
        get: operations["adminListEntities"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/content/entities/{entityId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one published entity */
        get: operations["adminGetEntity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/content/decks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List published decks */
        get: operations["adminListDecks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/content/decks/{deckId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one published deck */
        get: operations["adminGetDeck"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/auth/google": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Sign in with an allowlisted Google account */
        post: operations["adminLoginWithGoogle"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Revoke the current admin session */
        post: operations["adminLogout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/content/drafts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List editorial drafts */
        get: operations["adminListDrafts"];
        put?: never;
        /**
         * Create a draft from the current editorial catalog
         * @description Imports the editorial catalog this deployment carries and records the catalog commit (`baseCatalogCommit`) and the active content version the draft starts from.
         */
        post: operations["adminCreateDraft"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/content/drafts/{draftId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draftId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        /** Get one draft with its document */
        get: operations["adminGetDraft"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Replace the draft document
         * @description Optimistic concurrency: `If-Match` carries the revision the client edited. A stale revision gets 409 instead of silently overwriting a colleague's work; a missing header gets 428. The document must conform to the versioned editorial-catalog JSON Schema.
         */
        patch: operations["adminUpdateDraft"];
        trace?: never;
    };
    "/v1/admin/content/drafts/{draftId}/decks": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draftId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        /**
         * List the decks a draft holds
         * @description Each deck reports its membership mode and the number of entities it resolves to, following the same rules the release build follows.
         */
        get: operations["adminListDraftDecks"];
        put?: never;
        /** Add a deck to a draft */
        post: operations["adminCreateDraftDeck"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/content/drafts/{draftId}/decks/{deckKey}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draftId: components["schemas"]["Uuid"];
                deckKey: string;
            };
            cookie?: never;
        };
        /** Get one draft deck with its resolved members */
        get: operations["adminGetDraftDeck"];
        put?: never;
        post?: never;
        /** Remove a deck from a draft */
        delete: operations["adminDeleteDraftDeck"];
        options?: never;
        head?: never;
        /**
         * Change a draft deck
         * @description Only the fields present in the request are replaced, so renaming a deck cannot silently rewrite an `all-current` membership into a list.
         */
        patch: operations["adminUpdateDraftDeck"];
        trace?: never;
    };
    "/v1/admin/content/drafts/{draftId}/entities": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draftId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        /**
         * List the editorial entities a draft holds
         * @description The editorial record of every entity — the selection and the overrides, never the merged build result — beside the short name the active release serves, so the list is readable by a human.
         */
        get: operations["adminListDraftEntities"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/content/drafts/{draftId}/entities/{entityKey}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draftId: components["schemas"]["Uuid"];
                entityKey: string;
            };
            cookie?: never;
        };
        /** Get one editorial entity with its published context */
        get: operations["adminGetDraftEntity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Change an editorial entity
         * @description Each field present in the request replaces the entity's field outright; `identifiers` and `overrides` replace as whole maps, and an empty map removes the field. There is no POST and no DELETE: an entity exists because upstream sources describe it, so the console edits the selection but never invents a country.
         */
        patch: operations["adminUpdateDraftEntity"];
        trace?: never;
    };
    "/v1/admin/content/drafts/{draftId}/assets": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draftId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        /** List the assets uploaded into a draft */
        get: operations["adminListDraftAssets"];
        put?: never;
        /**
         * Upload a replacement asset into a draft
         * @description Multipart upload. The bytes decide what the file is — the filename and the declared media type are ignored — and only SVG or PNG is accepted. SVG is sanitized before storage, the checksum, dimensions and aspect ratio are computed server-side, and the object lands in a non-public bucket that is only ever read back through the preview endpoint. Re-uploading identical bytes returns the existing asset rather than creating a second one.
         */
        post: operations["adminUploadDraftAsset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/content/drafts/{draftId}/assets/{assetId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draftId: components["schemas"]["Uuid"];
                assetId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove an uploaded asset from a draft */
        delete: operations["adminDeleteDraftAsset"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/content/drafts/{draftId}/assets/{assetId}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read the bytes of a draft asset
         * @description Draft objects live in a non-public bucket, so the console reads them back through the API rather than linking at storage.
         */
        get: operations["adminPreviewDraftAsset"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/content/drafts/{draftId}/validate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Validate a draft against the editorial rules
         * @description Applies the editorial rules a release build applies and stores the verdict on the draft: READY when nothing blocks, FAILED otherwise. Rules that need the pinned upstream snapshots stay with the build, which is the only place that has them.
         */
        post: operations["adminValidateDraft"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/content/drafts/{draftId}/diff": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Compare a draft with the active release
         * @description What a release built from this draft would change, in the domain's own words. Entity facts derived from upstream sources are absent on purpose: the console does not own them.
         */
        get: operations["adminDiffDraft"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/content/drafts/{draftId}/proposal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Open a pull request from a validated draft
         * @description Commits the deterministic export to `admin/draft-<id>` and opens a draft pull request whose body carries the diff and the validation verdict. The console never writes to the base branch: review is the single merge point between it and the source-refresh bot. Repeating the call returns the existing pull request rather than opening a second one, and every expectation in the request must still hold or the call is refused.
         */
        post: operations["adminProposeDraft"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/content/drafts/{draftId}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download the deterministic export of a draft
         * @description The canonical serialization of the draft document — the exact bytes a proposal will commit as `editorial/catalog.json`. An unedited draft exports byte-identically to the file it was imported from.
         */
        get: operations["adminExportDraft"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/content/releases/publish-run": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read the active version and the last publish run */
        get: operations["adminGetPublishRun"];
        put?: never;
        /**
         * Start a dev publish run
         * @description Dispatches the existing publish workflow. The console never publishes itself: the signing key stays in CI and the long serializable transaction stays on a direct database connection. Re-publishing the active version is refused, because the publisher would answer `alreadyPublished` and that reads as success.
         */
        post: operations["adminStartPublishRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List admin users */
        get: operations["adminListUsers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/users/{adminUserId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                adminUserId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        /** Get one admin user */
        get: operations["adminGetUser"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Change an admin user's role or status
         * @description Any effective change revokes every active session of the target, so new privileges never ride on old sessions. An administrator cannot change their own role or status — the contour must not be able to lock itself out.
         */
        patch: operations["adminUpdateUser"];
        trace?: never;
    };
    "/v1/admin/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the authenticated admin user */
        get: operations["getAdminMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        AdminGoogleLoginRequest: {
            /** @description Google ID token issued to the admin console's OAuth client. */
            idToken: string;
        };
        /**
         * @description Closed protocol enum (ADR-009): roles drive the console state machine, so adding one is a breaking change of the admin contract.
         * @enum {string}
         */
        AdminRole: "VIEWER" | "EDITOR" | "PUBLISHER" | "ADMIN";
        /**
         * @description Closed protocol enum (ADR-009). A disabled admin loses access immediately, including active sessions.
         * @enum {string}
         */
        AdminUserStatus: "ACTIVE" | "DISABLED";
        AdminUser: {
            id: components["schemas"]["Uuid"];
            /** Format: email */
            email: string;
            displayName: string;
            role: components["schemas"]["AdminRole"];
            status: components["schemas"]["AdminUserStatus"];
            createdAt: components["schemas"]["DateTime"];
        };
        AdminUserList: {
            items: components["schemas"]["AdminUser"][];
            total: number;
        };
        AdminUserUpdateRequest: {
            role?: components["schemas"]["AdminRole"];
            status?: components["schemas"]["AdminUserStatus"];
        };
        /**
         * @description Closed protocol enum (ADR-009): the console's editorial state machine depends on these values.
         * @enum {string}
         */
        AdminDraftStatus: "DRAFT" | "VALIDATING" | "READY" | "PROPOSED" | "MERGED" | "FAILED";
        AdminDraftSummary: {
            id: components["schemas"]["Uuid"];
            baseContentVersion: string;
            baseCatalogCommit: string;
            schemaVersion: number;
            revision: number;
            status: components["schemas"]["AdminDraftStatus"];
            proposalUrl: string | null;
            createdByAdminUserId: components["schemas"]["Uuid"];
            updatedByAdminUserId: components["schemas"]["Uuid"];
            createdAt: components["schemas"]["DateTime"];
            updatedAt: components["schemas"]["DateTime"];
        };
        AdminDraftList: {
            items: components["schemas"]["AdminDraftSummary"][];
            total: number;
        };
        AdminDraftDetail: components["schemas"]["AdminDraftSummary"] & {
            /** @description The editorial catalog document, validated server-side against the versioned editorial-catalog JSON Schema. */
            document: Record<string, never>;
            validationReport: Record<string, never> | null;
        };
        AdminDraftUpdateRequest: {
            /** @description Full replacement of the editorial document; must conform to the editorial-catalog JSON Schema or the request is refused. */
            document: Record<string, never>;
        };
        AdminDraftStamp: {
            draftId: components["schemas"]["Uuid"];
            revision: number;
            status: components["schemas"]["AdminDraftStatus"];
            updatedAt: components["schemas"]["DateTime"];
        };
        AdminDeckLocalizedText: {
            name: string;
            description: string;
        };
        /** @description The three shapes the editorial model supports: the whole approved catalog, an explicit list of entity keys, or a taxonomy node whose descendants form the deck. */
        AdminDeckMembers: "all-current" | string[] | {
            taxonomy: string;
        };
        AdminDraftDeck: {
            key: string;
            /** @enum {string} */
            kind: "curated" | "taxonomy";
            names: {
                [key: string]: components["schemas"]["AdminDeckLocalizedText"];
            };
            /** @enum {string} */
            membersMode: "all-current" | "explicit" | "taxonomy";
            members: components["schemas"]["AdminDeckMembers"];
            memberCount: number;
        };
        AdminDraftDeckList: {
            items: components["schemas"]["AdminDraftDeck"][];
            total: number;
        };
        AdminDraftDeckDetail: components["schemas"]["AdminDraftDeck"] & {
            /** @description The entity keys the deck resolves to right now, sorted the way the release build sorts them. */
            memberKeys: string[];
        };
        AdminDraftDeckCreateRequest: {
            key: string;
            /** @enum {string} */
            kind: "curated" | "taxonomy";
            names: {
                [key: string]: components["schemas"]["AdminDeckLocalizedText"];
            };
            members: components["schemas"]["AdminDeckMembers"];
        };
        AdminDraftDeckUpdateRequest: {
            /** @enum {string} */
            kind?: "curated" | "taxonomy";
            names?: {
                [key: string]: components["schemas"]["AdminDeckLocalizedText"];
            };
            members?: components["schemas"]["AdminDeckMembers"];
        };
        /** @enum {string} */
        AdminEntityType: "country" | "territory" | "area" | "region" | "subregion";
        /** @enum {string} */
        AdminEntityStatus: "active" | "historical" | "retired" | "hidden";
        AdminEntityIdentifiers: {
            isoAlpha2?: string;
            isoAlpha3?: string;
            m49?: string;
            wikidataId?: string;
            editorialKey?: string;
            customCode?: string;
        };
        /** @description Dotted-path patches the editorial layer pins on purpose (`names.ru.short` → value), applied with the pipeline's highest priority. Absence of the field means no overrides; an empty object is never stored. */
        AdminEntityOverrides: {
            [key: string]: unknown;
        };
        AdminDraftEntityListItem: {
            key: string;
            type: components["schemas"]["AdminEntityType"];
            status: components["schemas"]["AdminEntityStatus"];
            includeInCountryCatalog: boolean;
            recognitionStatus: string;
            identifiers: components["schemas"]["AdminEntityIdentifiers"];
            overrideCount: number;
            /** @description The short name the active release serves, null when the release does not carry the entity yet. */
            publishedName: string | null;
        };
        AdminDraftEntityList: {
            items: components["schemas"]["AdminDraftEntityListItem"][];
            total: number;
        };
        AdminDraftEntity: {
            key: string;
            type: components["schemas"]["AdminEntityType"];
            status: components["schemas"]["AdminEntityStatus"];
            includeInCountryCatalog: boolean;
            recognitionStatus: string;
            /** Format: date */
            recognitionAsOf?: string;
            /** Format: date */
            validFrom?: string;
            /** Format: date */
            validTo?: string;
            identifiers?: components["schemas"]["AdminEntityIdentifiers"];
            overrides?: components["schemas"]["AdminEntityOverrides"];
        };
        AdminDraftEntityDetail: {
            entity: components["schemas"]["AdminDraftEntity"];
            /** @description Locale → the short name the active release serves; what an override the entity does not carry falls back to at build time. */
            publishedNames: {
                [key: string]: string;
            };
        };
        AdminDraftEntityUpdateRequest: {
            type?: components["schemas"]["AdminEntityType"];
            status?: components["schemas"]["AdminEntityStatus"];
            includeInCountryCatalog?: boolean;
            recognitionStatus?: string;
            /** @description An ISO date, or null to clear the field. */
            recognitionAsOf?: string | null;
            validFrom?: string | null;
            validTo?: string | null;
            identifiers?: components["schemas"]["AdminEntityIdentifiers"];
            overrides?: components["schemas"]["AdminEntityOverrides"];
        };
        AdminDraftAsset: {
            id: components["schemas"]["Uuid"];
            draftId: components["schemas"]["Uuid"];
            entityContentKey: string;
            assetType: string;
            variant: string;
            /** @enum {string} */
            mimeType: "image/svg+xml" | "image/png";
            sha256: string;
            width: number | null;
            height: number | null;
            aspectRatio: number | null;
            sourceUrl: string | null;
            licenseName: string | null;
            licenseUrl: string | null;
            attribution: string | null;
            replacementReason: string | null;
            /** @enum {string} */
            validationStatus: "PENDING" | "VALID" | "INVALID";
            createdAt: components["schemas"]["DateTime"];
            updatedAt: components["schemas"]["DateTime"];
        };
        AdminDraftAssetList: {
            items: components["schemas"]["AdminDraftAsset"][];
            total: number;
        };
        AdminDraftAssetUploadRequest: {
            /** Format: binary */
            file: string;
            entityContentKey: string;
            /** @enum {string} */
            assetType: "FLAG" | "COAT_OF_ARMS";
            /** @default default */
            variant: string;
            sourceUrl: string;
            licenseName: string;
            licenseUrl?: string;
            attribution?: string;
            /** @description Why a human replaced the upstream drawing. Required: it travels into the proposal and the audit trail. */
            replacementReason: string;
        };
        AdminValidationFinding: {
            /** @enum {string} */
            level: "blocking" | "warning";
            code: string;
            subject: string;
            message: string;
        };
        AdminValidationReport: {
            validatedAt: components["schemas"]["DateTime"];
            blocking: number;
            warnings: number;
            findings: components["schemas"]["AdminValidationFinding"][];
        };
        AdminDraftValidationResult: {
            status: components["schemas"]["AdminDraftStatus"];
            revision: number;
            report: components["schemas"]["AdminValidationReport"];
        };
        /** @description An editorial key and a published code are two namespaces, so an entry names both: a deck the draft adds has no published code yet, and one it drops has no editorial key any more. At least one is always present. */
        AdminDeckDiffEntry: {
            deckKey: string | null;
            publishedCode: string | null;
            /** @enum {string} */
            change: "added" | "removed" | "changed";
            details: string[];
        };
        AdminAssetDiffEntry: {
            entityContentKey: string;
            assetType: string;
            /** @enum {string} */
            change: "added" | "replaced";
            reason: string | null;
        };
        /** @description What the draft changed about one editorial entity, against the catalog this deployment was built from. Entities cannot be created or deleted editorially, so every entry is a change. */
        AdminEntityDiffEntry: {
            entityKey: string;
            details: string[];
        };
        AdminDraftDiff: {
            baseContentVersion: string;
            /** @description True when a release from this draft would change nothing. */
            isEmpty: boolean;
            decks: components["schemas"]["AdminDeckDiffEntry"][];
            assets: components["schemas"]["AdminAssetDiffEntry"][];
            entities: components["schemas"]["AdminEntityDiffEntry"][];
        };
        /** @description What the client believed when it decided to propose. Any disagreement is refused rather than resolved silently. */
        AdminProposalRequest: {
            draftRevision: number;
            baseContentVersion: string;
            baseCatalogCommit: string;
        };
        AdminProposalResult: {
            draftId: components["schemas"]["Uuid"];
            status: components["schemas"]["AdminDraftStatus"];
            /** Format: uri */
            proposalUrl: string;
            pullRequestNumber: number;
        };
        AdminWorkflowRun: {
            id: number;
            status: string;
            conclusion: string | null;
            /** Format: uri */
            url: string;
            createdAt: components["schemas"]["DateTime"];
        };
        AdminPublishRunStatus: {
            /** @description False when this deployment has no GitHub credential, in which case a release is started by hand. */
            configured: boolean;
            activeVersion: string | null;
            lastRun: components["schemas"]["AdminWorkflowRun"] | null;
        };
        AdminPublishRunRequest: {
            contentVersion: string;
            /** @description The oldest client this release lets read it; a client below it gets an update screen instead of a catalog, so this is a product decision rather than a formatting detail. */
            minimumClientVersion: string;
        };
        AdminContentStatus: {
            activeVersion: string | null;
            schemaVersion: number | null;
            /** Format: date-time */
            publishedAt: string | null;
            /** @description The client version the live release demands. Raising it in a new release locks every older installed app out of the content, so the console offers this value as the next release's default rather than a number of its own. */
            minimumClientVersion: string | null;
            entityCount: number;
            deckCount: number;
        };
        AdminAssetRepresentation: {
            /** Format: uri */
            url: string;
            mimeType: string;
            sha256: string;
            scale: number | null;
            widthPx: number | null;
            heightPx: number | null;
        };
        AdminAsset: {
            id: components["schemas"]["Uuid"];
            type: string;
            variant: string;
            width: number | null;
            height: number | null;
            aspectRatio: number | null;
            licenseName: string;
            licenseUrl: string | null;
            attribution: string | null;
            source: {
                name: string;
                /** Format: uri */
                url: string;
            };
            representations: components["schemas"]["AdminAssetRepresentation"][];
        };
        AdminEntityName: {
            locale: components["schemas"]["Locale"];
            nameType: string;
            value: string;
            isPrimary: boolean;
        };
        AdminEntitySummary: {
            id: components["schemas"]["Uuid"];
            contentKey: string;
            slug: string;
            kind: string;
            /** @enum {string} */
            status: "ACTIVE" | "HISTORICAL" | "HIDDEN";
            recognitionStatus: string;
            isoAlpha2: string | null;
            isoAlpha3: string | null;
            nameRu: string | null;
            nameEn: string | null;
            flag: components["schemas"]["AdminAsset"] | null;
            contentVersion: string;
        };
        AdminEntityList: {
            items: components["schemas"]["AdminEntitySummary"][];
            total: number;
        };
        AdminEntityDetail: components["schemas"]["AdminEntitySummary"] & {
            names: components["schemas"]["AdminEntityName"][];
            assets: components["schemas"]["AdminAsset"][];
            includeInCountryCatalog: boolean;
            /** Format: date-time */
            validFrom: string | null;
            /** Format: date-time */
            validTo: string | null;
        };
        AdminDeckSummary: {
            id: components["schemas"]["Uuid"];
            code: string;
            kind: string;
            /** @enum {string} */
            status: "DRAFT" | "PUBLISHED" | "RETIRED";
            cardCount: number;
            nameRu: string | null;
            nameEn: string | null;
            contentVersion: string;
        };
        AdminDeckList: {
            items: components["schemas"]["AdminDeckSummary"][];
            total: number;
        };
        AdminDeckLocalization: {
            locale: components["schemas"]["Locale"];
            name: string;
            description: string;
        };
        AdminDeckDetail: components["schemas"]["AdminDeckSummary"] & {
            localizations: components["schemas"]["AdminDeckLocalization"][];
            ruleSpec: Record<string, never> | null;
        };
        /** Format: uuid */
        Uuid: string;
        ErrorEnvelope: {
            error: {
                code: string;
                message: string;
                requestId: components["schemas"]["Uuid"];
                details: {
                    [key: string]: unknown;
                };
            };
        };
        Locale: string;
        /** Format: date-time */
        DateTime: string;
    };
    responses: {
        /** @description The If-Match header with the draft revision is missing. */
        DraftIfMatchRequired: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorEnvelope"];
            };
        };
        /** @description Request failed with a typed error. */
        ErrorResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorEnvelope"];
            };
        };
        /** @description Authentication or session proof is invalid. */
        UnauthorizedResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "UNAUTHORIZED",
                 *         "message": "Authentication is required",
                 *         "requestId": "11bdc6ea-93e2-46e4-bd6c-5a14cec9f488",
                 *         "details": {}
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["ErrorEnvelope"];
            };
        };
        /** @description Payload violates the versioned request contract. */
        ValidationResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "VALIDATION_FAILED",
                 *         "message": "One or more fields are invalid",
                 *         "requestId": "11bdc6ea-93e2-46e4-bd6c-5a14cec9f488",
                 *         "details": {
                 *           "fields": [
                 *             "events[0].eventName"
                 *           ]
                 *         }
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["ErrorEnvelope"];
            };
        };
        /** @description Requested resource does not exist in the authorized scope. */
        NotFoundResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "RESOURCE_NOT_FOUND",
                 *         "message": "The requested resource was not found",
                 *         "requestId": "11bdc6ea-93e2-46e4-bd6c-5a14cec9f488",
                 *         "details": {}
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["ErrorEnvelope"];
            };
        };
        /** @description Request rate limit was exceeded. */
        RateLimitResponse: {
            headers: {
                /** @description Seconds until the client may retry. */
                "Retry-After"?: number;
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorEnvelope"];
            };
        };
        /** @description Request conflicts with current state or idempotency history. */
        ConflictResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "IDEMPOTENCY_CONFLICT",
                 *         "message": "The identifier was already used with another payload",
                 *         "requestId": "11bdc6ea-93e2-46e4-bd6c-5a14cec9f488",
                 *         "details": {}
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["ErrorEnvelope"];
            };
        };
    };
    parameters: {
        AdminOffset: number;
        /** @description The draft revision the editor read, for optimistic concurrency. */
        DraftIfMatch: string;
        AdminLimit: number;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    adminGetContentStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The active content version and catalog counts; nulls when no release has ever been published. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminContentStatus"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminListEntities: {
        parameters: {
            query?: {
                offset?: components["parameters"]["AdminOffset"];
                limit?: components["parameters"]["AdminLimit"];
                /** @description Case-insensitive search over names, slug, content key and ISO codes. */
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of published entities, ordered by slug. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminEntityList"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            422: components["responses"]["ValidationResponse"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminGetEntity: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                entityId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The entity with all names and published assets. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminEntityDetail"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            404: components["responses"]["NotFoundResponse"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminListDecks: {
        parameters: {
            query?: {
                offset?: components["parameters"]["AdminOffset"];
                limit?: components["parameters"]["AdminLimit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of published decks, ordered by code. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDeckList"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminGetDeck: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                deckId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The deck with all localizations and its rule spec. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDeckDetail"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            404: components["responses"]["NotFoundResponse"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminLoginWithGoogle: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminGoogleLoginRequest"];
            };
        };
        responses: {
            /** @description Admin session established; the opaque session cookie is set on the response. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUser"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            /** @description The account is not allowlisted, is disabled, or the request origin is not an admin console origin. The response does not reveal which. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            422: components["responses"]["ValidationResponse"];
            429: components["responses"]["RateLimitResponse"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminLogout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Session revoked and the session cookie cleared. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["UnauthorizedResponse"];
            /** @description The request origin is not an admin console origin. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminListDrafts: {
        parameters: {
            query?: {
                offset?: components["parameters"]["AdminOffset"];
                limit?: components["parameters"]["AdminLimit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of drafts, most recently updated first. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDraftList"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminCreateDraft: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The imported draft. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDraftDetail"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            /** @description The caller is below the EDITOR role, or the request origin is not an admin console origin. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description No active content release exists to start from. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminGetDraft: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draftId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The draft, including its editorial document. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDraftDetail"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            404: components["responses"]["NotFoundResponse"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminUpdateDraft: {
        parameters: {
            query?: never;
            header: {
                "If-Match": string;
            };
            path: {
                draftId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminDraftUpdateRequest"];
            };
        };
        responses: {
            /** @description The updated draft with a bumped revision. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDraftDetail"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            /** @description The caller is below the EDITOR role, or the request origin is not an admin console origin. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            404: components["responses"]["NotFoundResponse"];
            409: components["responses"]["ConflictResponse"];
            422: components["responses"]["ValidationResponse"];
            /** @description The If-Match header with the draft revision is missing. */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminListDraftDecks: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draftId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The draft's decks in document order. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDraftDeckList"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            404: components["responses"]["NotFoundResponse"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminCreateDraftDeck: {
        parameters: {
            query?: never;
            header: {
                /** @description The draft revision the editor read, for optimistic concurrency. */
                "If-Match": components["parameters"]["DraftIfMatch"];
            };
            path: {
                draftId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminDraftDeckCreateRequest"];
            };
        };
        responses: {
            /** @description The deck was added; the draft's revision moved on. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDraftStamp"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            /** @description The caller is below the EDITOR role, or the request origin is not an admin console origin. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            404: components["responses"]["NotFoundResponse"];
            409: components["responses"]["ConflictResponse"];
            422: components["responses"]["ValidationResponse"];
            428: components["responses"]["DraftIfMatchRequired"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminGetDraftDeck: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draftId: components["schemas"]["Uuid"];
                deckKey: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The deck and the entity keys it currently resolves to. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDraftDeckDetail"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            404: components["responses"]["NotFoundResponse"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminDeleteDraftDeck: {
        parameters: {
            query?: never;
            header: {
                /** @description The draft revision the editor read, for optimistic concurrency. */
                "If-Match": components["parameters"]["DraftIfMatch"];
            };
            path: {
                draftId: components["schemas"]["Uuid"];
                deckKey: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The deck was removed; the draft's revision moved on. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDraftStamp"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            /** @description The caller is below the EDITOR role, or the request origin is not an admin console origin. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            404: components["responses"]["NotFoundResponse"];
            /** @description The draft moved on, or this is the catalog's last deck. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            428: components["responses"]["DraftIfMatchRequired"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminUpdateDraftDeck: {
        parameters: {
            query?: never;
            header: {
                /** @description The draft revision the editor read, for optimistic concurrency. */
                "If-Match": components["parameters"]["DraftIfMatch"];
            };
            path: {
                draftId: components["schemas"]["Uuid"];
                deckKey: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminDraftDeckUpdateRequest"];
            };
        };
        responses: {
            /** @description The deck was changed; the draft's revision moved on. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDraftStamp"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            /** @description The caller is below the EDITOR role, or the request origin is not an admin console origin. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            404: components["responses"]["NotFoundResponse"];
            409: components["responses"]["ConflictResponse"];
            422: components["responses"]["ValidationResponse"];
            428: components["responses"]["DraftIfMatchRequired"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminListDraftEntities: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draftId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The draft's entities in document order. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDraftEntityList"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            404: components["responses"]["NotFoundResponse"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminGetDraftEntity: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draftId: components["schemas"]["Uuid"];
                entityKey: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The editorial record and the names the active release currently serves, which are what an override falls back to. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDraftEntityDetail"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            404: components["responses"]["NotFoundResponse"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminUpdateDraftEntity: {
        parameters: {
            query?: never;
            header: {
                /** @description The draft revision the editor read, for optimistic concurrency. */
                "If-Match": components["parameters"]["DraftIfMatch"];
            };
            path: {
                draftId: components["schemas"]["Uuid"];
                entityKey: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminDraftEntityUpdateRequest"];
            };
        };
        responses: {
            /** @description The entity was changed; the draft's revision moved on. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDraftStamp"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            /** @description The caller is below the EDITOR role, or the request origin is not an admin console origin. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            404: components["responses"]["NotFoundResponse"];
            409: components["responses"]["ConflictResponse"];
            422: components["responses"]["ValidationResponse"];
            428: components["responses"]["DraftIfMatchRequired"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminListDraftAssets: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draftId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The draft's uploaded assets. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDraftAssetList"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            404: components["responses"]["NotFoundResponse"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminUploadDraftAsset: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draftId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["AdminDraftAssetUploadRequest"];
            };
        };
        responses: {
            /** @description The stored draft asset. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDraftAsset"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            /** @description The caller is below the EDITOR role, or the request origin is not an admin console origin. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            404: components["responses"]["NotFoundResponse"];
            /** @description The file is empty, too large, not an SVG or PNG, unsafe, or the required provenance fields are missing. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminDeleteDraftAsset: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draftId: components["schemas"]["Uuid"];
                assetId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The asset is no longer part of the draft. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["UnauthorizedResponse"];
            /** @description The caller is below the EDITOR role, or the request origin is not an admin console origin. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            404: components["responses"]["NotFoundResponse"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminPreviewDraftAsset: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draftId: components["schemas"]["Uuid"];
                assetId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The stored drawing. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/svg+xml": string;
                    "image/png": string;
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            404: components["responses"]["NotFoundResponse"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminValidateDraft: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draftId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The stored verdict. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDraftValidationResult"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            /** @description The caller is below the EDITOR role, or the request origin is not an admin console origin. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            404: components["responses"]["NotFoundResponse"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminDiffDraft: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draftId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The domain diff against the active release. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDraftDiff"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            404: components["responses"]["NotFoundResponse"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminProposeDraft: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draftId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminProposalRequest"];
            };
        };
        responses: {
            /** @description The draft is proposed. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminProposalResult"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            /** @description The caller is below the PUBLISHER role, or the request origin is not an admin console origin. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            404: components["responses"]["NotFoundResponse"];
            /** @description The draft moved on, the catalog moved on, the draft is not validated, it still has blocking findings, or it would change nothing. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            422: components["responses"]["ValidationResponse"];
            /** @description This deployment has no GitHub credential; download the export and open the pull request by hand. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminExportDraft: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draftId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The canonical catalog.json file. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            404: components["responses"]["NotFoundResponse"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminGetPublishRun: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The publish state this deployment can see. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminPublishRunStatus"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminStartPublishRun: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPublishRunRequest"];
            };
        };
        responses: {
            /** @description The run was requested. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminPublishRunStatus"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            /** @description The caller is below the PUBLISHER role, or the request origin is not an admin console origin. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description That version is already the active release. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            422: components["responses"]["ValidationResponse"];
            /** @description This deployment cannot reach GitHub. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminListUsers: {
        parameters: {
            query?: {
                offset?: components["parameters"]["AdminOffset"];
                limit?: components["parameters"]["AdminLimit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of the admin roster, ordered by email. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUserList"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            /** @description The caller does not hold the ADMIN role. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminGetUser: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                adminUserId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The admin user. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUser"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            /** @description The caller does not hold the ADMIN role. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            404: components["responses"]["NotFoundResponse"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    adminUpdateUser: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                adminUserId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminUserUpdateRequest"];
            };
        };
        responses: {
            /** @description The updated admin user. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUser"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            /** @description The caller does not hold the ADMIN role, targets themselves, or the request origin is not an admin console origin. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            404: components["responses"]["NotFoundResponse"];
            422: components["responses"]["ValidationResponse"];
            default: components["responses"]["ErrorResponse"];
        };
    };
    getAdminMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The admin user bound to the current session */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "8f1f9f76-1f0a-4a2e-9a5e-2b8f4f1c9d10",
                     *       "email": "editor@example.com",
                     *       "displayName": "Content Editor",
                     *       "role": "VIEWER",
                     *       "status": "ACTIVE",
                     *       "createdAt": "2026-08-23T10:00:00Z"
                     *     }
                     */
                    "application/json": components["schemas"]["AdminUser"];
                };
            };
            401: components["responses"]["UnauthorizedResponse"];
            default: components["responses"]["ErrorResponse"];
        };
    };
}
