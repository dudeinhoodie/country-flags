# IOS-001 — Xcode project и CI foundation

## Метаданные

- Тип: iOS foundation
- Приоритет: P0
- Зависимости: нет
- Рекомендуемый slug: `ios-project-foundation`

## Результат

Создать воспроизводимый iOS workspace, на котором последующие задачи могут
разрабатывать независимые модули, не меняя build topology.

## Контекст

Baseline закреплён в `docs/02-ios-spec.md`: Swift 6 language mode, SwiftUI,
iOS 17+, structured concurrency, SwiftData, XCTest/XCUITest и SPM. Xcode project
пока отсутствует. Основная логика должна жить в локальном Swift Package, app
target остаётся composition root.

## Scope

Создать:

- `ios/CountryFlags.xcodeproj`;
- app target `CountryFlagsApp`;
- local package `CountryFlagsKit` с targets:
  - `CountryFlagsDomain`;
  - `CountryFlagsInfrastructure`;
  - `CountryFlagsFeatures`;
- unit test targets и `CountryFlagsUITests`;
- `Mock`, `Dev`, `Prod` configurations/schemes;
- `Base/Mock/Dev/Prod.xcconfig` и `Local.xcconfig.example`;
- typed root navigation;
- минимальные design tokens;
- RU/EN string catalogs;
- dependency composition protocol/container;
- iOS README и CI workflow.

## Архитектурные ограничения

- Domain не импортирует SwiftUI, SwiftData, OpenFeature или OAuth SDK.
- Не создавать target на каждый экран.
- Не добавлять Tuist/XcodeGen/CocoaPods без отдельного ADR.
- Environment values не должны быть global mutable singletons.
- Prod не содержит mock endpoints/debug menu.
- Секреты, signing identities и local paths не коммитятся.

## Acceptance criteria

- clean checkout собирает Mock и Dev без signing;
- Swift 6 strict concurrency включён;
- app показывает локализованный shell и typed route;
- unit test и UI launch smoke проходят;
- Mock transport boundary доступен через DI, но сеть не реализуется в этой задаче;
- `Package.resolved` и выбранная Xcode version закреплены;
- README содержит setup, schemes, build/test commands и secret policy;
- CI сохраняет xcresult при failure.

## Проверка

~~~bash
xcodebuild -project ios/CountryFlags.xcodeproj -scheme CountryFlags-Mock \
  -destination 'platform=iOS Simulator,name=iPhone 17' CODE_SIGNING_ALLOWED=NO build
xcodebuild -project ios/CountryFlags.xcodeproj -scheme CountryFlags-Mock \
  -destination 'platform=iOS Simulator,name=iPhone 17' CODE_SIGNING_ALLOWED=NO test
~~~

Если simulator name отличается в CI, workflow должен выбирать зафиксированный
доступный runtime/device и документировать его.

## Вне задачи

- OpenAPI client;
- SwiftData production schema;
- feature screens;
- Apple/Google SDK;
- signing/TestFlight.

## Handoff агенту

Прочитать `docs/02-ios-spec.md:27-91`. Сохранить структуру небольшой:
дополнительный module target допускается только при доказанной compile-time или
ownership необходимости.
