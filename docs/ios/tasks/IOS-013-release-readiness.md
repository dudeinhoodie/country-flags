# IOS-013 — UX hardening, accessibility и release readiness

## Метаданные

- Тип: iOS quality/release
- Приоритет: P1
- Зависимости: IOS-005, IOS-006, IOS-007, IOS-008, IOS-009, IOS-010, IOS-011, IOS-012
- Рекомендуемый slug: `ios-release-readiness`

## Результат

MVP готов к TestFlight/App Store: основные flows протестированы, accessibility и
localization проверены, release build воспроизводим и не содержит debug/secret
артефактов.

## Scope

### UX hardening

- loading/empty/error/offline/stale states;
- dark mode;
- маленький экран;
- длинные RU/EN строки;
- keyboard/safe-area/rotation, где применимо;
- network degradation и backend unavailable;
- animation consistency;
- сверка экранов с `docs/16-ios-design-language.md`: анти-паттерны отсутствуют,
  открытые решения раздела 12 закрыты или явно перенесены;
- визуальная проверка на release toolchain, а не только на CI-версии Xcode.

### Accessibility

- Dynamic Type;
- VoiceOver labels, traits, order и announcements;
- Reduce Motion;
- contrast;
- tap targets;
- accessibility UI smoke.

### CI/release

- PR build + unit/integration + guest UI smoke;
- nightly full UI suite;
- pinned Xcode/simulator;
- unsigned archive verification;
- real-device checklist;
- TestFlight archive/export/upload workflow;
- dSYM step для выбранного provider;
- App Store privacy/legal/reviewer checklist.

## Acceptance criteria

- clean checkout собирается документированной командой;
- PR CI проверяет contract drift, build, tests и guest smoke;
- nightly suite покрывает self-rated, multiple-choice, auth mocks, migration,
  offline sync, achievement и deletion;
- RU/EN, dark mode, large Dynamic Type, VoiceOver и Reduce Motion проходят checklist;
- reviewer может проверить core experience без login;
- Privacy Policy/Terms доступны;
- release не содержит mock URL, debug overrides и database reset;
- production secrets отсутствуют в repository/archive logs;
- реальное устройство прошло Apple/Google, Keychain, notifications,
  background transitions и плохую сеть;
- App Store privacy labels соответствуют фактическим SDK/data flows;
- реклама остаётся NoOp и ATT purpose string отсутствует;
- README описывает build/test/release/credentials.

## Проверка

- выполнить все documented xcodebuild commands;
- сохранить xcresult и archive evidence;
- провести manual real-device checklist;
- проверить dependency privacy manifests/signatures;
- выполнить secret scan release artifacts/logs.

## Вне задачи

- новый функционал;
- реальный ad SDK;
- автоматический App Store production submission;
- редизайн;
- Android/Web release.

## Handoff агенту

Прочитать `docs/02-ios-spec.md:651-759` и все открытые iOS limitations. Эта
задача исправляет найденные дефекты в пределах MVP, но не расширяет product
scope. Непройденный acceptance criterion оформляется blocker-ом, а не
игнорируется ради архива.
