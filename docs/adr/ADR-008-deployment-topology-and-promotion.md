# ADR-008: Deployment topology and immutable promotion

- Status: Proposed
- Date: 2026-08-07

## Context

Backend имеет production Dockerfile, PostgreSQL migrations, S3-compatible storage,
health endpoints и CI. Отсутствуют hosted dev/prod, release registry, promotion и
проверенный disaster recovery.

Инфраструктура должна быть дешёвой для одного владельца и не связывать domain
code с PaaS. Polling workers работают внутри API, поэтому production не может
регулярно scale to zero.

## Decision

- Сохранять OCI/Docker container boundary.
- Публиковать GHCR images с immutable sha-commit tag и digest.
- Автоматически разворачивать successful master в dev.
- В production вручную продвигать тот же проверенный image.
- Koyeb Free для dev, always-on Koyeb Eco для production.
- Отдельные Neon PostgreSQL projects для dev/prod.
- Отдельные R2 buckets через S3 adapter.
- Local Compose и ephemeral PostgreSQL в CI.
- Не создавать staging до появления release trigger.
- Migrations выполнять отдельным single-flight job.
- Использовать expand/contract без automatic down migrations.
- Добавить DEPLOYMENT_ENV отдельно от NODE_ENV.
- Проверять readiness/smoke и хранить deployment metadata.
- Делать logical backups и restore drills независимо от provider PITR.

## Consequences

- Dev бесплатный, initial production compute дешёвый.
- Production не зависит от cold start.
- Один artifact проходит dev и prod.
- Data и credentials имеют отдельный blast radius.
- GitHub deployment credentials требуют ротации и stronger protection при росте команды.
- Neon Free не является окончательным production SLA.
- Sleeping dev приостанавливает in-process workers.
- Manual provider provisioning остаётся debt до решения об IaC.

## Alternatives

- Render: free web cold starts и временная free PostgreSQL.
- Railway: прост, но free credit мал для постоянных app+database workloads.
- Fly.io: нет устойчивого free tier и выше operational complexity.
- VPS: преждевременное ownership ОС, TLS, firewall и availability.
- Kubernetes: несоразмерен одному modular monolith.
- Одна dev/prod database: общий blast radius.
- Rebuild для production: artifact уже не идентичен проверенному в dev.

## Revisit triggers

- pricing/limits providers меняются;
- нужен SLA, private network, multi-region;
- workers требуют независимого scaling;
- появляется staging/release train;
- команда требует IaC/protected environments/external secrets;
- latency, memory или database limits превышают tiers.
