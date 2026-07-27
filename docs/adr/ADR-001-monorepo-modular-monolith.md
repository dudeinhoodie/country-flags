# ADR-001: Monorepo, modular monolith and Yarn

Status: Accepted  
Date: 2026-07-27

## Context

Country Flags needs one backend for iOS, Android and web. The initial domain has
strong transactional boundaries between accounts, content, sessions, reviews and
progress. Splitting these flows across services would introduce distributed
transactions before the product has operational evidence that they are needed.

The original implementation baseline selected pnpm. The product owner explicitly
selected Yarn before implementation started.

## Decision

- Keep backend, contracts, content tooling and infrastructure in one monorepo.
- Implement the backend as a NestJS modular monolith.
- Use Yarn workspaces with a version pinned in the root `packageManager` field.
- Use Corepack in local development and CI.
- Commit `yarn.lock` and require `yarn install --immutable` in CI.
- Use Yarn's `node-modules` linker for predictable NestJS, Prisma and container
  tooling interoperability.
- Add a separate worker entrypoint only when a real asynchronous workload appears.

## Consequences

- Domain modules can share one PostgreSQL transaction where required.
- API and schema contracts stay versioned beside the implementation.
- The repository has one dependency lock and one package-manager policy.
- A future service extraction requires an ADR and evidence such as independent
  scaling, isolation or ownership needs.
- The package-manager choice intentionally supersedes the pnpm statements in
  backend specification baseline 0.2.

## Alternatives considered

- pnpm workspaces: technically suitable, but rejected by the explicit product
  decision to use Yarn.
- npm workspaces: no advantage over the selected Yarn workflow.
- Microservices: deferred because they increase deployment and consistency cost
  without an initial scaling requirement.
