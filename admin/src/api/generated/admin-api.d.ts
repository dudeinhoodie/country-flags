// Generated from contracts/dist/admin-openapi.bundle.yaml.
// Do not edit by hand: run `corepack yarn admin:api:generate` at the repository root.
export interface paths {
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
        /** Format: date-time */
        DateTime: string;
    };
    responses: {
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
    };
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
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
