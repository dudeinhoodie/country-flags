# Техническое задание: окружения и deployment backend

Статус: Proposed implementation baseline 0.1  
Дата: 7 августа 2026 года  
Зависимости: [Backend spec](./01-backend-spec.md), [Observability spec](./06-observability-analytics.md)  
Архитектурное решение: [ADR-008](./adr/ADR-008-deployment-topology-and-promotion.md)  
Tracking: [GitHub epic #35](https://github.com/dudeinhoodie/country-flags/issues/35)

## 1. Цель

Настроить воспроизводимый и безопасный путь от pull request до dev и production
без Kubernetes, shared test data и повторной сборки release artifact.

Baseline должен:

- сохранять Docker, PostgreSQL и S3-compatible границы переносимыми;
- давать мобильным и web-клиентам стабильный dev API;
- проверять PR на изолированной эфемерной базе;
- автоматически выкатывать проверенный master в dev;
- продвигать в production только уже проверенный immutable image;
- разделять данные, credentials, OAuth clients, feature flags и telemetry;
- иметь проверяемые migration, rollback, backup и restore procedures;
- начинаться с бесплатной dev-инфраструктуры и минимальной стоимости production.

## 2. Границы первой итерации

Входят:

- local, CI, dev и production environments;
- GitHub Actions как CI/CD orchestrator;
- GHCR как registry release images;
- Google Cloud Run как runtime target;
- Neon PostgreSQL;
- S3-совместимое object storage через существующий adapter;
- health checks, smoke tests, deployment records и rollback;
- backup automation и регулярный restore drill.

Не входят:

- Kubernetes, собственный VPS и администрирование ОС;
- постоянный staging и PR preview environments;
- multi-region/high availability;
- отдельный worker service;
- IaC state до стабилизации provider configuration.

До появления внешнего TestFlight cohort или параллельной release train CI является
testing environment, а dev — общей интеграционной средой.

## 3. Целевая топология

~~~mermaid
flowchart LR
    PR["Pull request"] --> CI["GitHub Actions CI"]
    CI --> CIPG["Ephemeral PostgreSQL 16"]
    MAIN["Merge to master"] --> BUILD["Build release image"]
    BUILD --> GHCR["GHCR sha-commit + digest"]
    GHCR --> MIGDEV["Dev migration"]
    MIGDEV --> DEV["Cloud Run dev"]
    DEV --> DEVDB["Neon dev"]
    DEV --> DEVSTORE["Object storage dev"]
    GHCR --> PROMOTE["Manual production promotion"]
    PROMOTE --> BACKUP["Pre-deploy backup"]
    BACKUP --> MIGPROD["Production migration"]
    MIGPROD --> PROD["Cloud Run production"]
    PROD --> PRODDB["Neon production"]
    PROD --> PRODSTORE["Object storage production"]
~~~

## 4. Матрица окружений

| Среда | Назначение | NODE_ENV | DEPLOYMENT_ENV | База | Deployment |
| --- | --- | --- | --- | --- | --- |
| local | Разработка | development | local | Compose PostgreSQL | Ручной |
| ci | PR/test jobs | test | ci | Эфемерный PostgreSQL | Нет |
| dev | Общая интеграция | production | dev | Отдельный Neon project | Автоматически из master |
| prod | Пользовательские данные | production | prod | Отдельный Neon project | Ручное promotion |

### 4.1 NODE_ENV и DEPLOYMENT_ENV

NODE_ENV определяет runtime semantics Node.js. Hosted dev и prod запускаются с
NODE_ENV=production.

DEPLOYMENT_ENV определяет environment-specific configuration: resource names,
telemetry, feature flags, public URL, OAuth clients, интеграции и data policy.
Допустимые значения: local, ci, dev, prod. Неизвестное значение останавливает
startup. Test auth и provider test tokens разрешены только в local/ci. Публичный
dev использует отдельные реальные Apple/Google dev clients.

## 5. Начальные providers

### Runtime

- Dev: один Cloud Run service в europe-west3, минимум ноль instances.
- Production: Cloud Run service в europe-west3, минимум 512 MB RAM и минимум один always-on instance.
- Runtime и PostgreSQL выбираются в ближайших доступных регионах.
- Dev может засыпать; cold start допустим и документируется.
- Production MUST быть always-on до подключения внешних пользователей.

Dev масштабируется до нуля и потому засыпает: первый запрос после простоя
платит за холодный старт. Для production это недопустимо, поэтому там минимум
один instance держится всегда.

Изначально этим target был Koyeb. Он заменён после того, как платформу
приобрёл Mistral: консоль перестала выдавать API-ключи, а продукт развернулся в
сторону AI-нагрузок. Cloud Run выбран за то, что разворачивает образ по
дайджесту — ровно то, чего требует immutable release — и не зависит от судьбы
одного стартапа. Цена: он не тянет образы из GHCR, поэтому deploy копирует
образ в Artifact Registry.

### PostgreSQL

- Отдельные Neon projects: country-flags-dev и country-flags-prod.
- Разные schemas одной базы не являются границей dev/prod.
- Runtime использует pooled DATABASE_URL.
- Migration job использует direct DIRECT_DATABASE_URL.
- Prisma configuration явно поддерживает direct migration URL.
- Connection limits учитывают ограничения Neon plan.

Free plan допустим для dev и закрытой альфы. До значимого пользовательского
трафика prod получает достаточный PITR/SLA либо отдельно доказанную защиту.

### Object storage

- Отдельные private buckets: country-flags-dev и country-flags-prod.
- Используется существующая S3-compatible boundary. Dev сегодня работает с
  Google Cloud Storage в том же GCP-проекте (см. 6.1); провайдер для prod
  выбирается тогда, когда цена исходящего трафика начнёт иметь значение, и
  адаптер от этого выбора не зависит.
- Credentials ограничиваются конкретным bucket и нужными actions.
- Account exports и backups никогда не публикуются.
- Backup bucket отделён от content bucket и имеет собственную retention policy.

## 6. Resource naming

~~~text
GHCR image: ghcr.io/dudeinhoodie/country-flags-backend
GCP project: speedy-web-235610
Artifact Registry: europe-west3-docker.pkg.dev/speedy-web-235610/country-flags
Cloud Run services: api-dev, api-prod
Neon projects: country-flags-dev, country-flags-prod
Object storage buckets: country-flags-dev, country-flags-prod, country-flags-prod-backups
GitHub environments: dev, production
~~~

Provider IDs не попадают в domain code.

### 6.1. One-time provisioning для dev

Deploy workflow ничего не создаёт: он разворачивает образ в уже существующий
service и читает уже существующие secrets. Перечисленное ниже создаётся один
раз владельцем проекта.

Cloud Run service и service accounts:

~~~bash
gcloud run deploy api-dev --region europe-west3 --image <любой стартующий образ>
gcloud iam service-accounts create api-dev-runtime   # runtime identity ревизии
gcloud iam service-accounts create github-deployer   # identity workflow
~~~

Secrets (имена фиксированы, workflows ссылаются именно на них):

~~~text
dev-database-url                       pooled Neon URL, runtime
dev-direct-database-url                direct Neon URL, migrations и publish
dev-auth-access-token-secret           ≥32 символов, только для dev
dev-auth-rate-limit-secret             ≥32 символов, только для dev
dev-account-data-hash-secret           ≥32 символов, только для dev
dev-object-storage-access-key-id       HMAC access key content-publisher
dev-object-storage-secret-access-key   HMAC secret content-publisher
dev-content-signing-private-key        base64 PKCS8 PEM, Ed25519
dev-content-signing-public-keys        base64 JSON keyId → SPKI PEM
~~~

Первые пять читает deploy, последние четыре — publish.

Database URLs берутся из Neon project country-flags-dev. Три auth secret не
имеют внешнего источника и генерируются:

~~~bash
printf %s "$(openssl rand -hex 32)" \
  | gcloud secrets create dev-auth-access-token-secret --data-file=-
gcloud secrets add-iam-policy-binding dev-auth-access-token-secret \
  --member=serviceAccount:api-dev-runtime@speedy-web-235610.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
~~~

Значение auth secret нигде не хранится вне Secret Manager: ротация — это новая
версия секрета и следующий deploy.

Bucket для контента (нужен не ревизии, а publish — см. раздел 7). Dev использует
Cloud Storage в том же GCP-проекте: аккаунт, IAM и Secret Manager там уже
есть, а S3-совместимый API GCS работает с существующим адаптером через
HMAC-ключ. Для prod провайдер ещё не выбран — там цена исходящего трафика
начнёт иметь значение, и решение принимается отдельно.

~~~text
bucket: country-flags-dev, uniform access, europe-west3
service account: content-publisher, роль Storage Object Admin на bucket
ключ: HMAC для этого service account (Settings → Interoperability)
endpoint: https://storage.googleapis.com, path-style
публичный адрес: https://storage.googleapis.com/country-flags-dev
~~~

Публичное чтение включается привязкой `allUsers` → `Storage Object Viewer` с
условием `resource.name.startsWith(".../objects/content/")`: наружу смотрят
только файлы релиза, а `content-bundles/` — архив, из которого восстанавливает
rollback, — остаётся приватным. Пока флаги зашиты в приложение (ADR-011),
публичное чтение не требуется вовсе.

Ключ подписи контента пары не имеет и создаётся один раз:

~~~bash
openssl genpkey -algorithm ed25519 -out signing.pem
openssl pkey -in signing.pem -pubout -out signing.pub.pem
base64 < signing.pem | tr -d '\n' \
  | gcloud secrets create dev-content-signing-private-key --data-file=-
python3 -c 'import json;print(json.dumps({"dev-2026-08": open("signing.pub.pem").read()}))' \
  | base64 | tr -d '\n' \
  | gcloud secrets create dev-content-signing-public-keys --data-file=-
rm signing.pem signing.pub.pem
~~~

`dev-2026-08` — это `SIGNING_KEY_ID` из workflow: не секрет, а имя ключа, которым
подписан релиз. Приватная половина после этого существует только в Secret
Manager; ротация — новая пара и новый keyId в обеих переменных.

Publish кладёт файлы релиза под ключ `content/<contentVersion>/<path>`, а клиенту
отдаёт этот же ключ за публичным адресом бакета. Поэтому
`OBJECT_STORAGE_PUBLIC_BASE_URL` — это корень бакета без завершающего слэша, а не
адрес с префиксом внутри; в production перед бакетом стоит CDN, и его домен даёт
ровно те URL, что публикуются сейчас.

Публикация в dev выполняется workflow `publish-content-dev.yml` через
`workflow_dispatch`, а не с чьей-то машины: credentials остаются в Secret
Manager и не расходятся по ноутбукам. Сборка релиза для dev отличается от
production двумя входами, и workflow делает ровно эти три шага:

~~~bash
corepack yarn content build --catalog-version fixture-v1 --publish-ready \
  --asset-base-url "$OBJECT_STORAGE_PUBLIC_BASE_URL/content/fixture-v1/" \
  --minimum-client-version 0.1.0
corepack yarn content:bundle:sign --bundle-dir "$PWD/content/generated/fixture-v1"
corepack yarn content:bundle:publish --bundle-dir "$PWD/content/generated/fixture-v1"
~~~

`--minimum-client-version` здесь не косметика: релиз отказывает клиенту ниже
указанной версии, и отказ — это экран обновления вместо каталога. Приложение
сейчас собирается как `0.1.0`, а значение по умолчанию — `1.0.0`, так что dev,
опубликованный без этого флага, не покажет ни одной колоды.

Флаги при этом не скачиваются: приложение несёт векторы релиза `fixture-v1`
внутри себя (ADR-011) и рисует их, пока checksum совпадает. Bucket нужен под
14 JSON-документов бандла — это архив, из которого восстанавливает rollback, —
и под исправленный флаг, байты которого разойдутся с зашитыми.

Остальная конфигурация ревизии не хранится в консоли. Deploy задаёт её целиком
на каждом запуске (`--set-env-vars` и `--set-secrets`), поэтому конфигурация dev
читается в `.github/workflows/deploy-dev.yml`, а правка через консоль
перезаписывается следующим deploy.

## 7. Configuration contract

Hosted environments требуют:

~~~text
NODE_ENV=production
DEPLOYMENT_ENV=dev|prod
PORT
LOG_LEVEL
PUBLIC_BASE_URL
DATABASE_URL
DIRECT_DATABASE_URL
APPLE_CLIENT_IDS
GOOGLE_CLIENT_IDS
AUTH_ACCESS_TOKEN_SECRET
AUTH_RATE_LIMIT_SECRET
ACCOUNT_DATA_HASH_SECRET
OBJECT_STORAGE_PROVIDER=s3
OBJECT_STORAGE_BUCKET
OBJECT_STORAGE_REGION
OBJECT_STORAGE_ENDPOINT
OBJECT_STORAGE_ACCESS_KEY_ID
OBJECT_STORAGE_SECRET_ACCESS_KEY
OBJECT_STORAGE_PUBLIC_BASE_URL
SERVICE_NAME
SERVICE_RELEASE
OTEL_ENABLED
OTEL_EXPORTER_OTLP_ENDPOINT
~~~

Требования:

- hosted startup не принимает test defaults;
- `OBJECT_STORAGE_*` читает только content bundle CLI, running API — нет,
  поэтому ревизия api-dev их не получает: они нужны там, откуда запускается
  publish, вместе с credentials на bucket этой среды (раздел 6.1);
- URL ассетов записывает publish по факту загрузки, а не по тому, что записано в
  манифесте бандла: релиз, опубликованный в dev, отдаёт адреса dev-бакета. Бандл
  собирается с адресом среды через `content build --asset-base-url`, по умолчанию
  — production CDN;
- dev/prod secrets не совпадают;
- SERVICE_RELEASE равен git SHA/image version;
- logs/traces/metrics содержат deployment.environment.name;
- секреты не передаются как Docker build args и не печатаются;
- .env.example описывает только форму configuration.

## 8. Pull request CI

PR workflow MUST:

1. Использовать committed source и pinned dependencies.
2. Поднимать чистый PostgreSQL 16 service.
3. Выполнять Prisma generate, validation и migrate deploy.
4. Запускать contracts, format, lint, typecheck, tests и deterministic content.
5. Собирать production Docker image.
6. Не обращаться к dev/prod PostgreSQL, object storage или deployment API.
7. Не получать production secrets.
8. Уничтожать service containers после job.

Долгоживущая testing database запрещена: shared state создаёт flaky tests и
лишние credentials.

## 9. Release image

После успешной проверки push в master:

1. GitHub Actions собирает release image.
2. Image публикуется в GHCR с immutable tag sha-commit.
3. OCI digest сохраняется в job summary/deployment metadata.
4. Image содержит OCI source, revision и created labels.
5. Mutable latest никогда не используется для promotion или rollback.
6. Production получает тот же SHA/digest, который проверен в dev.

По умолчанию job permissions равны contents: read. packages: write выдаётся
только publish job. Third-party actions SHOULD быть pinned по full commit SHA.

## 10. Dev continuous deployment

Release image из master автоматически запускает:

1. Проверку dev configuration.
2. Migration job через DIRECT_DATABASE_URL.
3. Явное обновление Cloud Run api-dev на immutable image по дайджесту.
4. Ожидание provider deployment status.
5. Smoke tests.
6. GitHub deployment record с URL и SHA.

Используется concurrency deploy-dev. Новый commit может отменить ожидающий
старый deploy, но не выполняющуюся migration.

## 11. Production promotion

Production workflow запускается только через workflow_dispatch и принимает
существующий image SHA/tag.

До deployment проверяется:

- image существует в GHCR;
- commit принадлежит default branch;
- image успешно прошёл dev deployment/smoke;
- production configuration доступна;
- другой production deployment не выполняется.

Последовательность:

1. Создать и проверить pre-deploy backup.
2. Выполнить production migration отдельным job.
3. Обновить Cloud Run api-prod.
4. Дождаться readiness.
5. Выполнить smoke tests.
6. Записать SHA, digest, migration version и operator.

Используется concurrency deploy-production без cancel-in-progress.

Для private repository GitHub Free не предоставляет environment secrets и
required reviewers. Пока владелец один, допустимы repository secrets DEV_/PROD_
и ручной workflow_dispatch. При появлении команды нужен GitHub plan или внешний
secret manager с защищёнными environments.

## 12. Миграции

- Миграции выполняются отдельным single-flight job, не при startup replicas.
- Используется expand/contract и совместимость с предыдущим image.
- Destructive migration отделяется от release, перестающего читать старую схему.
- Автоматические down migrations запрещены.
- Ошибка migration останавливает deploy и сохраняет текущий service image.
- Connection strings не попадают в logs.

## 13. Health checks и smoke

- Container liveness: GET /v1/health/live.
- Provider readiness: GET /v1/health/ready.
- Readiness проверяет PostgreSQL.
- Grace period учитывает cold start и Prisma initialization.

Минимальный post-deploy smoke:

1. liveness;
2. readiness;
3. публичные app-config/content manifest;
4. публичный список колод;
5. ожидаемый unauthorized защищённого endpoint;
6. release/environment metadata без secrets.

Smoke повторяется с bounded retry и завершается ошибкой по deadline.

## 14. Фоновые workers

Polling workers пока запускаются внутри API process.

- На sleeping dev задержка ожидаема.
- Production API остаётся always-on.
- DB leases/idempotency сохраняют корректность при нескольких replicas.
- Метрики показывают outbox lag, retries и dead-letter state.
- Отдельный Worker Service требует нового ADR и scale/isolation evidence.

## 15. Rollback

Application rollback:

1. Выбрать последний healthy production SHA.
2. Проверить совместимость с текущей схемой.
3. Обновить service на предыдущий immutable image.
4. Выполнить smoke.
5. Зафиксировать deployment/incident record.

Database rollback выполняется forward-fix или restore, не down migration. Цель:
application rollback не более 15 минут.

## 16. Backup и disaster recovery

Минимальная production policy:

- provider PITR/time travel включён;
- ежедневный logical pg_dump;
- backup перед production migrations;
- private country-flags-prod-backups bucket;
- retention 30 дней;
- checksum и шифрование при хранении/передаче;
- production credentials отсутствуют в PR workflows;
- ежемесячный restore drill в изолированную временную БД;
- sanitized CI summary без пользовательских данных.

Цели закрытой альфы:

- RPO: 24 часа;
- RTO: 4 часа;
- application rollback: 15 минут.

До public launch цели пересматриваются по объёму review events.

## 17. Deployment observability

Каждый release передаёт service.name, service.version, deployment.environment.name,
provider deployment ID и migration version.

Минимальные production alerts:

- readiness failures;
- sustained 5xx;
- restart loop;
- database connection/storage thresholds;
- analytics/reconciliation/scheduler worker lag;
- backup или restore drill failure.

GitHub хранит release SHA, actor, environment, result и URL независимо от
provider logs.

## 18. Security

- Runtime container работает non-root.
- Registry image private до отдельного решения.
- Deployment token имеет минимальный provider scope.
- Object storage credentials ограничены bucket/environment.
- Fork/untrusted PR не получает secrets.
- pull_request_target с checkout недоверенного кода запрещён.
- Secrets маскируются и ротируются.
- Production data не копируются в dev без анонимизации.

## 19. Стоимость и этапы

До production: Cloud Run dev в пределах free tier, Neon и object storage в пределах free tier, prod service выключен.

Закрытая альфа: Cloud Run dev в пределах free tier, prod always-on несколько USD/month, Neon Free
только вместе с собственной backup policy, object storage в пределах free tier.

Public launch: always-on compute, PostgreSQL plan с подходящим PITR/monitoring,
budget alerts и resize по p95 latency, memory, connections и worker lag.

## 20. Общие критерии готовности

- PR не использует shared dev/prod database.
- Merge успешного master автоматически обновляет dev.
- Production принимает только проверенный immutable image.
- Dev/prod не разделяют database, bucket или secrets.
- Migration failure не переключает deployment.
- Readiness и smoke блокируют неуспешное promotion.
- Compatible image откатывается за 15 минут.
- Backup регулярно восстанавливается в тестовую БД.
- Runbook не содержит скрытых ручных шагов.

## 21. Официальные источники

- [Cloud Run service configuration](https://cloud.google.com/run/docs/configuring/services)
- [Cloud Run deploying images](https://cloud.google.com/run/docs/deploying)
- [Cloud Run health checks](https://cloud.google.com/run/docs/configuring/healthchecks)
- [Neon pricing](https://neon.com/pricing)
- [Cloud Storage pricing](https://cloud.google.com/storage/pricing)
- [Cloud Storage S3-совместимый API](https://cloud.google.com/storage/docs/interoperability)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/) — кандидат для prod
- [Cloudflare R2 S3](https://developers.cloudflare.com/r2/get-started/s3/)
- [GitHub environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [GitHub deployment control](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)
- [GitHub Actions security](https://docs.github.com/en/actions/reference/security/secure-use)
- [GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
