# Формат JSON-каталога

Статус: `Draft 0.1`  
Schema: [catalog.schema.json](../content/schemas/catalog.schema.json)  
Пример: [catalog.sample.json](../content/examples/catalog.sample.json)

## 1. Рекомендация

Список следует передавать как один versioned JSON-документ, разделённый на три независимые секции:

- `entities` — страны, территории, регионы и субрегионы;
- `relations` — принадлежность стран к регионам в конкретной классификации;
- `decks` — редакционные подборки, например «Все» и «Популярные».

Это лучше одного плоского массива стран:

- страна может входить в несколько регионов;
- одна сущность может находиться сразу в UN M49 и редакционной классификации;
- частично признанной сущности не требуется выдумывать ISO-код;
- порядок и состав «Популярных» можно менять отдельно;
- локализации не создают поля `nameRu`, `nameEn`, `nameDe` для каждого нового языка;
- связи можно обновлять без переписывания самой страны.

## 2. Стабильный ключ

Каждая сущность имеет редакционный `key`:

```json
{
  "key": "country.france"
}
```

Правила:

- ключ создаётся один раз и не переводится;
- ключ не меняется при переименовании страны;
- ключ не обязан совпадать с ISO;
- ключ используется только в импорте и ссылках между JSON-секциями;
- backend при первом импорте связывает key с внутренним UUID;
- удалённый ключ нельзя переиспользовать для другой сущности.

Примеры:

- `country.france`
- `country.kosovo`
- `territory.greenland`
- `region.europe`
- `subregion.western_europe`

## 3. Минимальная запись страны

```json
{
  "key": "country.example",
  "type": "country",
  "status": "active",
  "includeInCountryCatalog": true,
  "recognition": {
    "status": "partially_recognized",
    "asOf": "2026-07-27"
  },
  "names": {
    "ru": {
      "short": "Название",
      "official": "Официальное название",
      "aliases": []
    },
    "en": {
      "short": "Name",
      "official": "Official name",
      "aliases": []
    }
  }
}
```

Обязательный минимум:

- `key`;
- `type`;
- `status`;
- `includeInCountryCatalog`;
- `recognition.status` для стран/территорий;
- `names.ru.short`;
- `names.en.short`.

Остальные данные можно обогатить при импорте.

## 4. Locale

Ключи объекта `names` — BCP 47 language tags:

```json
{
  "names": {
    "ru": { "short": "Германия" },
    "en": { "short": "Germany" },
    "de": { "short": "Deutschland" },
    "pt-BR": { "short": "Alemanha" },
    "zh-Hans": { "short": "德国" }
  }
}
```

Нельзя добавлять новые поля наподобие `nameDe`. Новый язык добавляется новым ключом locale.

В каждой locale поддерживаются:

- `short` — основное название в карточке;
- `official` — официальное полное название;
- `aliases` — допустимые альтернативы для поиска и будущего текстового ответа.

Fallback locale задаётся клиентом и manifest:

1. точная locale, например `pt-BR`;
2. базовый язык, например `pt`;
3. `defaultLocale`;
4. безопасный placeholder.

## 5. Коды

```json
{
  "codes": {
    "isoAlpha2": "FR",
    "isoAlpha3": "FRA",
    "m49": "250"
  }
}
```

Все коды опциональны. Для сущности без официального ISO-кода:

```json
{
  "codes": {
    "customCode": "XK"
  }
}
```

Неофициальный `XK` нельзя записывать как `isoAlpha2`: иначе мы потеряем различие между официальным стандартом и редакционным идентификатором.

## 6. Статус признания

Поддерживаемые значения:

- `un_member`
- `un_observer`
- `partially_recognized`
- `unrecognized`
- `dependent_territory`
- `special_area`
- `not_applicable`

Пример:

```json
{
  "recognition": {
    "status": "partially_recognized",
    "asOf": "2026-07-27",
    "note": {
      "ru": "Редакционная заметка при необходимости",
      "en": "Optional editorial note"
    }
  }
}
```

Рекомендация — не хранить одно голое число «признано N странами»: оно быстро устаревает и скрывает методику подсчёта. Если позже потребуется детальная матрица признания, её нужно оформить отдельным versioned dataset с источниками и периодом действия.

## 7. Регионы

Регион является такой же сущностью:

```json
{
  "key": "region.europe",
  "type": "region",
  "status": "active",
  "includeInCountryCatalog": false,
  "names": {
    "ru": { "short": "Европа" },
    "en": { "short": "Europe" }
  }
}
```

Принадлежность хранится отдельно:

```json
{
  "parentKey": "region.europe",
  "childKey": "country.france",
  "taxonomyKey": "taxonomy.editorial.v1",
  "relationType": "contains",
  "primary": true
}
```

Одна страна может иметь несколько relations. `taxonomyKey` объясняет, почему страна отнесена к этому региону.

## 8. Колоды

```json
{
  "key": "deck.popular",
  "kind": "curated",
  "names": {
    "ru": {
      "name": "Популярные",
      "description": "Знакомые и часто встречающиеся флаги"
    },
    "en": {
      "name": "Popular",
      "description": "Commonly encountered flags"
    }
  },
  "memberEntityKeys": [
    "country.france",
    "country.japan"
  ]
}
```

Порядок `memberEntityKeys` MAY использоваться как редакционный порядок. Состав колоды версионируется вместе с `catalogVersion`.

### 8.1 Будущая колода исторических государств

Формат заранее поддерживает категорию «Прекратившие существование государства», но её наполнение не входит в MVP. Историческое государство хранится отдельной сущностью с неизменяемым редакционным `key`, обычным географическим `type`, `status: "historical"`, периодом существования в `validFrom`/`validTo` и `includeInCountryCatalog: false`.

Будущая колода использует ключ `deck.historical_states` и содержит только явно утверждённые редакцией сущности. Исторические сущности не должны автоматически попадать в `deck.all`, современные региональные колоды или текущий алгоритм выбора карточек.

## 9. Что не следует класть в этот файл

Основной каталог содержит стабильные данные идентичности и группировки. Отдельно следует хранить:

- население и другие регулярно обновляемые факты;
- валюты и периоды их действия;
- assets и лицензии файлов;
- исторические версии флагов;
- пользовательский прогресс;
- правила достижений;
- настройки планировщика.

Предлагаемая структура:

```text
content/
├── schemas/
│   └── catalog.schema.json
├── examples/
│   └── catalog.sample.json
├── catalog/
│   └── catalog.json
├── facts/
│   ├── population.json
│   └── currencies.json
├── assets/
│   └── assets.json
└── decks/
    └── additional-decks.json
```

Для первого списка достаточно `content/catalog/catalog.json`. Разделение на несколько production-файлов можно выполнить, когда каталог станет неудобно редактировать целиком.

## 10. Версионирование

В корне документа:

```json
{
  "schemaVersion": 1,
  "catalogVersion": "2026.07-draft.1",
  "defaultLocale": "ru",
  "supportedLocales": ["ru", "en"]
}
```

- `schemaVersion` меняется при изменении структуры JSON.
- `catalogVersion` меняется при изменении содержания.
- Импорт одной версии атомарен.
- Перед публикацией importer показывает diff.
- Физическое удаление сущности запрещено, если у неё есть review; используется `status: "retired"`.

## 11. Проверки импортера

Importer MUST отклонить публикацию при:

- невалидном JSON Schema;
- повторяющемся `key`;
- ссылке на отсутствующий entity key;
- отсутствии обязательного RU/EN short name;
- дублировании ISO-кода;
- неофициальном коде в ISO-поле;
- цикле региональных relations;
- сущности в колоде со статусом `retired`;
- пустой обязательной колоде;
- неизвестной locale syntax;
- повторе одного member key в колоде.

Importer SHOULD предупреждать, но не обязательно блокировать при:

- отсутствии ISO/M49;
- отсутствии official name;
- отсутствии региона;
- частично признанном статусе без редакционной заметки;
- изменении состава существующей колоды;
- переименовании сущности.

## 12. Production content bundle

Отдельный `catalog.json` остаётся удобным входным форматом владельца продукта. Backend publisher собирает из исходников атомарный bundle:

```text
manifest.json
catalog.json
assets.json
facts.json
currencies.json
card-templates.json
decks.json
```

Каждый файл имеет отдельную JSON Schema Draft 2020-12. Manifest содержит schema/content versions, locale, minimum client/template versions, размер и SHA-256 каждого файла, а также signature metadata.

Правила:

- published bundle неизменяем;
- исправление создаёт новую `contentVersion`;
- active version переключается только после проверки всех обязательных файлов;
- rollback переключает manifest pointer, но не удаляет старый bundle;
- technical asset replacement сохраняет learning-card progress;
- material flag change создаёт новую semantic learning card;
- session snapshot продолжает ссылаться на revision/checksum, с которыми была создана.

Пока production-каталог не предоставлен, разработка использует отдельный deterministic fixture. Он должен содержать минимум восемь сущностей, RU/EN, частично признанную сущность, трансконтинентальную связь, две колоды, разные пропорции флагов и один пример content revision.
