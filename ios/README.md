# iOS client

Swift 6 / SwiftUI / iOS 17+ клиент Country Flags.

Здесь описан только запуск проекта. Требования к продукту — в
[docs/02-ios-spec.md](../docs/02-ios-spec.md), порядок задач — в
[docs/ios/README.md](../docs/ios/README.md), форма API-контракта — в
[docs/15-ios-client-readiness.md](../docs/15-ios-client-readiness.md).

## Структура

```text
ios/
├── CountryFlags.xcodeproj      # composition root, три конфигурации
├── CountryFlagsApp/            # @main, сборка зависимостей, ассеты
├── CountryFlagsKit/            # локальный Swift Package со всей логикой
│   └── Sources/
│       ├── CountryFlagsDomain          # типы и правила; без UI и SDK
│       ├── CountryFlagsInfrastructure  # границы внешнего мира
│       └── CountryFlagsFeatures        # SwiftUI, навигация, design tokens
├── CountryFlagsUITests/        # launch smoke
├── Config/                     # xcconfig на каждую конфигурацию
└── Scripts/select-simulator.sh # выбор destination для xcodebuild
```

Логика живёт в пакете, а не в app target: пакет собирается и тестируется
отдельно, а Xcode-проект остаётся тонким. Новый target добавляется только при
доказанной compile-time или ownership необходимости.

`CountryFlagsDomain` не импортирует SwiftUI, SwiftData, OpenFeature и OAuth SDK —
это проверяется его зависимостями в `Package.swift`.

## Требования

- Xcode 16 или новее (Swift 6 language mode). Локально проект собран на
  Xcode 26.0.1.
- Установленный iOS-платформенный компонент и хотя бы один симулятор iOS 17+:
  `xcodebuild -downloadPlatform iOS`, либо Xcode → Settings → Components.
- Signing не требуется: сборка и тесты идут на симуляторе с
  `CODE_SIGNING_ALLOWED=NO`.

## Схемы и конфигурации

| Схема               | Конфигурация | Окружение | Назначение                                      |
| ------------------- | ------------ | --------- | ----------------------------------------------- |
| `CountryFlags-Mock` | `Mock`       | `mock`    | детерминированный запуск и тесты без сети        |
| `CountryFlags-Dev`  | `Dev`        | `dev`     | сборка против dev-развёртывания backend          |
| `CountryFlags-Prod` | `Prod`       | `prod`    | релизная сборка без mock-транспорта и отладки    |

Окружение приходит из xcconfig в Info.plist и читается
`RuntimeConfigurationLoader`. Условной компиляции `#if DEBUG` для выбора
окружения нет: конфигураций три, а условий компиляции две.

Тесты запускает только схема Mock: она включает unit-тесты пакета и UI launch
smoke.

## Сборка и тесты

```bash
cd ios

# Печатает destination и выбранный симулятор.
./Scripts/select-simulator.sh

xcodebuild -project CountryFlags.xcodeproj -scheme CountryFlags-Mock \
  -destination "$(./Scripts/select-simulator.sh)" \
  CODE_SIGNING_ALLOWED=NO build

xcodebuild -project CountryFlags.xcodeproj -scheme CountryFlags-Mock \
  -destination "$(./Scripts/select-simulator.sh)" \
  CODE_SIGNING_ALLOWED=NO test

xcodebuild -project CountryFlags.xcodeproj -scheme CountryFlags-Dev \
  -destination "$(./Scripts/select-simulator.sh)" \
  CODE_SIGNING_ALLOWED=NO build
```

Имя симулятора зависит от версии Xcode, поэтому `select-simulator.sh` берёт
первое доступное устройство из зафиксированного списка предпочтений
(iPhone 17 Pro → … → iPhone 15) на runtime iOS 17 или новее и печатает выбор в
stderr. Тот же скрипт использует CI, поэтому локальный и удалённый прогон
выбирают устройство одинаково.

## Локальная конфигурация и секреты

```bash
cp Config/Local.xcconfig.example Config/Local.xcconfig
```

`Config/Local.xcconfig` не коммитится и содержит только идентификаторы
разработчика: `CF_DEVELOPMENT_TEAM`, персональный суффикс bundle ID и, при
необходимости, адрес локального backend.

Политика секретов:

- в репозиторий не попадают токены, ключи провайдеров, signing identity,
  provisioning profiles и локальные пути;
- значения в `Base/Mock/Dev/Prod.xcconfig` публичные: имя окружения, публичный
  базовый URL и URL-схема;
- access и refresh токены в последующих задачах хранятся в Keychain и не
  попадают в UserDefaults, SwiftData, логи и аналитику;
- в `xcconfig` нельзя писать `//` без экранирования — используйте `https:/$()/`.

## Зависимости

Внешних пакетов пока нет: всё, что нужно этой задаче, покрывают системные
фреймворки. Поэтому в репозитории нет `Package.resolved` — Xcode создаёт его,
когда появляется первая удалённая зависимость, и с этого момента файл
коммитится вместе с изменением. Первые внешние пакеты придут с IOS-002
(swift-openapi-generator) и IOS-009 (Google Sign-In).

## CI

[`.github/workflows/ios-ci.yml`](../.github/workflows/ios-ci.yml) запускается на
изменения в `ios/**`: проверяет версию Xcode, выбирает симулятор, собирает и
тестирует Mock, собирает Dev. При падении `.xcresult` сохраняется артефактом.
