# Contributing

Working rules for this repository. Agent-specific rules live in
[`AGENTS.md`](AGENTS.md); this file records the conventions a human and an
agent both follow.

## Branch names

One rule, so a branch name says what the work answers to:

| Work | Branch |
| --- | --- |
| A GitHub Issue | `dev/<issue-number>-<short-slug>` |
| Everything else | `<type>/<short-slug>` |

`<type>` is the same set the commit messages use: `feat`, `fix`, `chore`,
`docs`, `refactor`, `test`, `build`, `ci`. The slug is lowercase words joined
by hyphens, short enough to read in a branch list.

```
dev/189-draft-storage-export      # implements issue #189
fix/session-survives-a-dead-network
chore/eslint-10
docs/deployment-environments
```

Issue-driven work takes the `dev/` form even when it is a fix or a chore: the
issue number is the more useful thing to see, and the issue itself already
says what kind of work it is. Work with no issue behind it — a dependency
bump, a typo, a rename — takes the typed form.

Automation keeps its own prefixes and is not covered by this rule:
`dependabot/*` and `automation/*` are created by bots.

## Pull requests

- One issue, one branch, one reviewable pull request.
- Link the issue with `Closes #<issue-number>` in the description.
- Say what was verified and what was not: a check that could not run locally
  is named along with the reason, never quietly omitted.
- Do not merge a stacked pull request until its base has landed **and** the
  child's base has actually moved to `master`. GitHub does not retarget a
  stacked pull request unless the base branch is deleted on merge, so a child
  merged too early lands in the feature branch instead of `master` — that has
  happened here twice (#144, #185).

## Commit messages

Conventional-commit style: `type(scope): what changed`, in the imperative.
The body explains why, not what the diff already shows.

## Quality gates

Run the checks relevant to what you touched; run the full set before opening a
pull request:

```bash
corepack yarn install --immutable
corepack yarn format:check
corepack yarn lint
corepack yarn typecheck
corepack yarn test
corepack yarn prisma:validate
corepack yarn build
```

Tests that need PostgreSQL run in CI. If you cannot run them locally, say so
in the pull request rather than implying they passed.

## Language

The repository works in English: code, comments, documentation, commit
messages, branch names, issues and pull requests. Application content is
localized through the product's own locale model and includes Russian.
