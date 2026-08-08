# AGENTS.md

Этот файл задаёт постоянные правила для coding-агентов, работающих с
репозиторием Country Flags. Он применяется ко всему репозиторию. Более
вложенный `AGENTS.md`, если появится позднее, может уточнять правила только для
своего поддерева.

## 1. Назначение проекта

Country Flags — кроссплатформенное приложение для запоминания флагов и других
данных о странах с интервальным повторением. Первый клиент — iOS, затем Android
и web. Текущий приоритет разработки — NestJS backend.

Основные директории:

- `backend/` — NestJS modular monolith;
- `ios/` — будущий Swift-клиент;
- `contracts/` — канонические OpenAPI и JSON Schema контракты;
- `content/` — schemas, examples и fixtures каталога;
- `infrastructure/` — локальная инфраструктура;
- `docs/` — продуктовые и технические требования, ADR.

Не реализуй код другой платформы в рамках платформенной задачи. В частности,
backend Issue не должна изменять `ios/`, если это прямо не требуется контрактом
или описанием Issue.

## 2. Источники требований и приоритет

Перед изменениями прочитай GitHub Issue целиком, включая зависимости, критерии
приёмки и раздел «Вне задачи».

При конфликте требований используй следующий приоритет:

1. последнее явное указание владельца продукта в текущей задаче;
2. описание текущей GitHub Issue;
3. platform handoff и основное platform ТЗ:
   - backend: `docs/08-backend-agent-handoff.md` и `docs/01-backend-spec.md`;
   - iOS: `docs/ios/README.md` и `docs/02-ios-spec.md`;
4. `docs/00-product-spec.md`;
5. тематические документы и существующие ADR;
6. существующая реализация.

Нельзя молча выбирать другую семантику. Существенное техническое отклонение
требует ADR с причиной, альтернативами, последствиями и migration path.

Для backend-задач прочитай только относящиеся к задаче документы, но до начала
первой backend-реализации в новой сессии ознакомься с:

1. `docs/08-backend-agent-handoff.md`;
2. `docs/01-backend-spec.md`;
3. `docs/04-content-json-format.md`;
4. тематическими `docs/05-*`, `docs/06-*` или `docs/07-*`, если Issue касается
   feature flags, observability/analytics или advertising.

Для iOS-задач агент сначала читает соответствующую спецификацию из
`docs/ios/tasks/`, затем релевантные разделы `docs/02-ios-spec.md`. iOS
должен потреблять committed OpenAPI-контракт, а не придумывать несовместимые
локальные DTO.

## 3. Workflow GitHub Issue

Если задача ссылается на GitHub Issue:

1. Получи Issue из `dudeinhoodie/country-flags`.
2. Проверь, что обязательные зависимости завершены или что текущая работа не
   требует их готовности.
3. Создай ветку `dev/<issue-number>-<short-slug>`.
4. Реализуй только scope Issue. Не включай пункты из раздела «Вне задачи».
5. Добавь или обнови тесты для каждого применимого критерия приёмки.
6. Запусти относящиеся к задаче quality gates.
7. Обнови документацию, если изменились API, schema, configuration, команды или
   архитектурное решение.
8. Создай отдельный Pull Request и добавь `Closes #<issue-number>` в описание.

Одна Issue по умолчанию соответствует одной ветке и одному Pull Request. Не
закрывай Issue вручную до merge. Epic Issue используется как трекер и не требует
отдельной ветки.

Если задача заблокирована credentials, внешним provider или продуктовым
решением, сначала исчерпай предусмотренные interfaces, NoOp/static adapters и
test fixtures. Не добавляй небезопасный production fallback. Если без нового
решения продолжить нельзя, зафиксируй конкретный blocker.

## 4. Зафиксированная backend-архитектура

- Node.js 22 или новее.
- Yarn workspaces через Corepack; версия закреплена в `packageManager`.
- NestJS и strict TypeScript.
- Modular monolith; не создавать microservices без нового ADR и доказанной
  необходимости.
- REST JSON API с prefix `/v1`.
- Contract-first OpenAPI; committed `contracts/openapi.yaml` является
  каноническим артефактом.
- JSON Schema использует Draft 2020-12 и стабильные `$id`.
- PostgreSQL является основной и единственной продуктовой БД на старте.
- Prisma ORM и migrations.
- Flexible content хранится в нормализованных сущностях/отношениях и
  валидируемом JSONB. Не добавлять MongoDB.
- Redis необязателен. API не должен зависеть от Redis без реальной потребности.
- Время хранится в UTC; locale использует BCP 47.
- Review history immutable; projections должны воспроизводиться из канонической
  истории.
- Scheduler — FSRS-6 через закреплённую версию `ts-fsrs`, desired retention
  `0.90`.
- Apple и Google являются auth providers, но не хранилищами прогресса.
- Identity нельзя автоматически объединять по email, display name или Apple
  private relay address.
- Feature flags используют OpenFeature. Первый provider — local/static с
  типизированными безопасными defaults.
- Advertising в MVP выключена. Допустимы только policy/provider boundaries и
  NoOp/default-off поведение; не добавлять ad SDK и ATT.
- Logs, error reporting, metrics, traces и analytics используют adapters.
  Внешние exporters по умолчанию NoOp и не должны блокировать бизнес-операции.

## 5. Контракты и API

- Сначала или одновременно с endpoint обновляй committed OpenAPI.
- Не создавай DTO, расходящийся с canonical schema.
- Все ошибки должны использовать единый typed error envelope.
- Публичные коллекции используют согласованную cursor pagination.
- Security-sensitive payload и registries по умолчанию имеют
  `additionalProperties: false`.
- Breaking change требует явной версии, migration plan и обновления клиентов.
- Идемпотентные операции должны иметь database constraint или эквивалентную
  транзакционную защиту, а не только in-memory проверку.
- Не раскрывай server-only flags, provider tokens, internal identifiers и
  secrets через app-config или error payload.

## 6. Данные и migrations

- Любое изменение Prisma schema сопровождается migration, если Issue явно не
  ограничена прототипом schema foundation.
- Пустая PostgreSQL должна подниматься всеми committed migrations без ручных
  SQL-шагов.
- Не редактируй уже опубликованную migration; создавай следующую.
- Для identity, idempotency, review ordering и content identifiers используй
  unique/check constraints там, где инвариант может обеспечить БД.
- Seed production-данных отделён от deterministic test fixtures.
- Fixture должен быть воспроизводим и не зависеть от внешней сети.
- Review events и audit history нельзя переписывать для удобства projection.

## 7. Безопасность и privacy

- Никогда не коммить secrets, реальные provider credentials, private keys или
  production tokens.
- `.env.example` содержит только безопасные placeholders и описывает env
  contract.
- Не логируй access/refresh tokens, authorization headers, raw identity tokens,
  email и другую запрещённую PII.
- Не передавай в продуктовую аналитику IDFA, provider payload, arbitrary error
  messages или данные, не зарегистрированные в analytics registry.
- Test auth/JWK signer не должен включаться при production validation.
- Все входные данные валидируются на границе API.
- Для чувствительных операций учитывай re-authentication, rate limits,
  idempotency и audit trail согласно ТЗ.

## 8. Стиль реализации и язык

Рабочий язык репозитория — английский. На английском пишутся все создаваемые и
изменяемые артефакты:

- код, имена, идентификаторы, строки логов и коды ошибок;
- комментарии и docstrings;
- README, техническая документация, ADR и runbooks;
- сообщения коммитов, названия и описания Pull Request;
- GitHub Issue: заголовок, описание и комментарии;
- имена веток, названия CI job и step.

Исключения:

- пользовательский контент приложения локализуется через предусмотренную модель
  locale и включает русский;
- цитата из существующего русскоязычного документа сохраняется как цитата;
- ответ агента владельцу продукта в чате идёт на языке его сообщения.

Существующие русскоязычные документы переводятся отдельной задачей, а не
попутно. Пока документ не переведён, не смешивай языки внутри него: правка
русского документа остаётся на русском, новый документ создаётся на английском.

- Следуй существующей структуре и паттернам; не выполняй несвязанный рефакторинг.
- Предпочитай небольшие модули с явными interfaces и dependency boundaries.
- Domain/application слои не должны импортировать SDK конкретного provider.
- Не скрывай обязательную работу за `TODO`, silent catch или placeholder success.
- Не добавляй абстракцию «на будущее», если её boundary не предусмотрена ТЗ.
- Сохраняй существующие пользовательские изменения и не используй destructive
  git-команды.
- Комментарии объясняют причину или инвариант, а не повторяют код.

## 9. Проверки

Запускай минимальный релевантный набор во время разработки и полный набор перед
завершением backend Issue:

```bash
corepack yarn install --immutable
corepack yarn format:check
corepack yarn lint
corepack yarn typecheck
corepack yarn test
corepack yarn prisma:validate
corepack yarn build
```

Если Issue изменяет БД, импорт, auth, HTTP contract или транзакционное поведение,
добавь integration/E2E tests с PostgreSQL. Моки допустимы для внешних provider
boundaries, но не должны заменять проверку транзакционных инвариантов.

Тесты должны быть детерминированы. Не обращайся к Apple, Google, object storage,
feature flag service или telemetry provider в обычном CI.

Не утверждай, что проверка прошла, если команда не запускалась или её результат
не был получен. Если часть проверок невозможно выполнить, перечисли точные
непроверенные команды и причину.

## 10. Definition of Done

Задача завершена, только если:

- реализован весь scope и не реализован явно исключённый scope;
- выполнены применимые критерии приёмки;
- добавлены необходимые unit/integration/E2E tests;
- релевантные quality gates проходят;
- OpenAPI, schemas, README и ADR обновлены при необходимости;
- нет новых secrets, запрещённой PII, скрытых обязательных TODO и
  недокументированных архитектурных отклонений;
- итог содержит краткое описание изменений, выполненных проверок и оставшихся
  внешних blockers;
- Pull Request связан с Issue через `Closes #<issue-number>`, если создание PR
  входило в запрос.
