# Deployment Agent Handoff

Статус: Ready for issue execution  
Источник: [Deployment spec](./13-deployment-environments.md)  
ADR: [ADR-008](./adr/ADR-008-deployment-topology-and-promotion.md)  
Tracking: [GitHub epic #35](https://github.com/dudeinhoodie/country-flags/issues/35)

## 1. Правила

Агент должен:

1. Прочитать AGENTS.md, deployment spec и этот handoff.
2. Работать в ветке dev/issue-id-slug.
3. Не менять target на Kubernetes/VPS/другой PaaS без ADR.
4. Не добавлять credentials, account IDs и connection strings в repository.
5. Сохранять local Compose и PR CI.
6. Использовать immutable image SHA/tag.
7. Добавлять tests/static validation для configuration и workflows.
8. Не выдавать dry-run за provider smoke без credentials.

## 2. Порядок

~~~text
DPL-1 Environment contract
  -> DPL-2 Release image / GHCR
    -> DPL-3 Dev infrastructure and CD
      -> DPL-4 Production promotion and rollback
      -> DPL-5 Backup and restore
      -> DPL-6 Deployment observability and runbooks
~~~

## 3. DPL-1 — Deployment environment contract ([#36](https://github.com/dudeinhoodie/country-flags/issues/36))

Цель: отделить runtime mode от deployment environment.

Объём:

- DEPLOYMENT_ENV=local|ci|dev|prod с fail-fast validation;
- NODE_ENV=production для hosted dev/prod;
- запрет test auth/tokens вне local/CI;
- environment/release metadata в logs и OTEL;
- DIRECT_DATABASE_URL для migrations, pooled DATABASE_URL для runtime;
- обновление .env.example, Compose и tests.

Приёмка:

- unknown environment останавливает startup;
- production build работает в dev и prod environment;
- test auth нельзя включить в hosted environments;
- оба database URLs валидируются как PostgreSQL;
- telemetry различает dev/prod и содержит release SHA;
- local/CI defaults не сломаны;
- tests покрывают safe и unsafe combinations.

Вне задачи: deployment workflows и provider resources.

Labels: priority:p0, agent-ready.

## 4. DPL-2 — Immutable release image и GHCR ([#37](https://github.com/dudeinhoodie/country-flags/issues/37))

Цель: публиковать один трассируемый image для dev/prod.

Объём:

- GHCR publish после успешного CI в master;
- immutable sha-commit tag и OCI digest;
- source/revision/created OCI labels;
- BuildKit cache без secrets;
- минимальные job permissions;
- provenance/job summary;
- image startup/liveness smoke.

Приёмка:

- PR не публикует image;
- успешный master публикует одну release version;
- повтор для SHA не меняет immutable artifact;
- digest/revision видны в summary;
- image запускается non-root и проходит health smoke;
- secrets отсутствуют в history/logs.

Зависимость: DPL-1.  
Вне задачи: Koyeb и hosted database migrations.

Labels: priority:p0, agent-ready.

## 5. DPL-3 — Dev infrastructure и continuous deployment ([#38](https://github.com/dudeinhoodie/country-flags/issues/38))

Цель: автоматически обновляемый dev API.

Объём:

- Koyeb api-dev из private GHCR;
- отдельный Neon dev project;
- отдельный R2 dev bucket и scoped credentials;
- dev migration до deploy;
- явный Koyeb redeploy;
- readiness и bounded smoke;
- GitHub deployment record;
- concurrency deploy-dev;
- one-time provisioning runbook.

Приёмка:

- successful master автоматически разворачивает тот же SHA;
- migration failure не меняет работающий image;
- используются только dev resources;
- success возможен только после readiness/smoke;
- GitHub показывает URL/SHA/result;
- повторный deploy идемпотентен;
- sleep/cold start документированы.

Зависимости: DPL-1, DPL-2, provider credentials.  
Вне задачи: production и permanent staging.

Label: priority:p0. Agent-ready после credentials или согласованного dry-run scope.

## 6. DPL-4 — Production promotion, migrations и rollback ([#39](https://github.com/dudeinhoodie/country-flags/issues/39))

Цель: безопасно продвигать проверенный image и откатывать release.

Объём:

- manual workflow_dispatch;
- существующий GHCR SHA, без rebuild;
- проверка default branch и successful dev deployment;
- pre-deploy backup gate;
- отдельная production migration;
- Koyeb api-prod с single-flight concurrency;
- readiness/smoke и deployment metadata;
- rollback на compatible immutable image;
- expand/contract runbook.

Приёмка:

- произвольный PR image нельзя выкатить;
- artifact не пересобирается;
- migration failure сохраняет current production;
- production deploy только один;
- smoke failure даёт actionable rollback;
- operator, SHA, digest и migration version записаны;
- documented dry-run не использует production data.

Зависимости: DPL-3 и production credentials.  
Вне задачи: down migration, multi-region, canary traffic.

Label: priority:p0. Agent-ready после DPL-3 и credentials.

## 7. DPL-5 — Automated backup, restore и DR drill ([#40](https://github.com/dudeinhoodie/country-flags/issues/40))

Цель: доказуемое восстановление production PostgreSQL.

Объём:

- ежедневный logical backup;
- backup перед production migration;
- private R2 backup bucket;
- checksum, encryption/transport и 30-day retention;
- restore в изолированную временную database;
- integrity checks после restore;
- monthly restore drill;
- sanitized summary и alert;
- incident/restore runbook.

Приёмка:

- неполный dump/upload/checksum завершает job ошибкой;
- objects private, retention автоматизирован;
- restore не пишет в production;
- restored data проходит integrity checks;
- cleanup выполняется и после ошибки;
- secrets/data отсутствуют в artifacts/logs;
- documented restore укладывается в RTO 4 часа.

Зависимости: DPL-3, backup bucket и restore database credentials.  
Вне задачи: cross-region replica и production data в dev.

Label: priority:p1.

## 8. DPL-6 — Deployment observability и runbooks ([#41](https://github.com/dudeinhoodie/country-flags/issues/41))

Цель: наблюдаемые deployment и recovery без собственного observability UI.

Объём:

- release/environment/deployment metadata в logs и OTEL;
- deployment annotations/summary;
- alerts readiness, 5xx, restarts, DB и worker lag;
- metrics analytics outbox, reconciliation и scheduler migration;
- provider-agnostic query/dashboard examples;
- deploy, rollback, migration, backup и secret rotation runbooks;
- release verification checklist.

Приёмка:

- по SHA находятся deployment и telemetry;
- dev/prod telemetry не смешивается;
- alerts не содержат PII/secrets;
- остановка worker обнаруживается;
- runbooks содержат команды, outputs и stop conditions;
- новый агент выполняет non-production drill без устных шагов;
- observability outage не ломает API.

Зависимости: DPL-3, DPL-4 и существующая observability реализация.  
Вне задачи: выбор собственного observability backend и product dashboards.

Label: priority:p1.

## 9. Отложенный DPL-7 — Staging и previews

Issue пока не создаётся. Триггеры:

- внешний TestFlight release candidate;
- несколько release trains;
- web preview URLs;
- destructive integration testing нельзя выполнять в dev;
- production-like migration rehearsal.

Будущий вариант: ephemeral app + Neon branch с TTL cleanup, без production
credentials и неанонимизированных production data.

## 10. Definition of Done

- DPL-1—DPL-6 закрыты с evidence.
- Dev следует последнему successful master image.
- Production продвигает тот же image вручную.
- Backup и restore drill доказаны.
- Deploy/rollback выполняются по committed runbook.
- Provider credentials отсутствуют в repository.
- Costs и plan limits имеют review date.
