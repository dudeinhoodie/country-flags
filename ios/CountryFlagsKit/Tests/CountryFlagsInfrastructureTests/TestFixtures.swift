import Foundation

/// Payloads copied from the committed contract fixtures.
///
/// The canonical fixture validator checks these documents against the bundled
/// contract, so a decoding test here fails when the contract moves rather than
/// when someone hand-wrote a payload wrong.
enum TestFixtures {
    static let appConfigJSON = """
{
  "configVersion": "config-2026-07-28.1",
  "generatedAt": "2026-07-28T12:00:00Z",
  "expiresAt": "2026-07-28T12:15:00Z",
  "minimumClientVersions": {
    "ios": {
      "minimumSupported": "1.0.0",
      "latest": "1.0.0",
      "updateMode": "NONE"
    }
  },
  "contentVersion": "2026.07-draft.1",
  "supportedTemplateSchemaVersions": [
    1
  ],
  "featureFlags": {
    "study.multiple_choice.enabled": {
      "type": "boolean",
      "value": false,
      "variant": "disabled",
      "activationPolicy": "nextSession"
    },
    "home.recommended_decks.variant": {
      "type": "string",
      "value": "control",
      "variant": "control",
      "activationPolicy": "nextLaunch"
    }
  },
  "advertising": {
    "policyVersion": "ads-policy-v1",
    "enabled": false,
    "mode": "DISABLED",
    "placements": {
      "home.bottom_banner": {
        "enabled": false,
        "format": "BANNER"
      }
    },
    "refreshAfter": "2026-07-28T12:15:00Z"
  }
}
"""

    static let completedSessionJSON = """
{
  "id": "90000000-0000-4000-8000-000000000006",
  "deckId": "70000000-0000-4000-8000-000000000001",
  "mode": "SELF_RATED",
  "selectionOrigin": "CLIENT_OFFLINE",
  "requestedUniqueCount": 5,
  "selectedUniqueCount": 1,
  "status": "COMPLETED",
  "contentVersion": "test-only-fixture-v1",
  "schedulerVersion": "test-fsrs-6-v2",
  "startedAt": "2026-07-29T10:00:00.000Z",
  "completedAt": "2026-07-29T10:01:30.000Z",
  "cards": [
    {
      "id": "a0000000-0000-4000-8000-000000000001",
      "learningCard": {
        "id": "50000000-0000-4000-8000-000000000005",
        "templateCode": "FLAG_TO_COUNTRY",
        "templateSchemaVersion": 1,
        "semanticVersion": 1,
        "revision": 1,
        "answerMode": "SELF_RATED",
        "prompt": {
          "asset": {
            "id": "40000000-0000-4000-8000-000000000005",
            "type": "FLAG",
            "url": "https://cdn.country-flags.test/test-only-fixture-v1/flags/kosovo.svg",
            "mimeType": "image/svg+xml",
            "sha256": "3f786850e387550fdab836ed7e6dc881de23001b8b9f4e0bd6c1b0aa5c0ba9b1",
            "width": 840,
            "height": 600,
            "aspectRatio": 1.4,
            "licenseName": "CC0-1.0",
            "attribution": null
          }
        },
        "answer": {
          "entityId": "30000000-0000-4000-8000-000000000005",
          "displayName": "Косово",
          "aliases": [
            "Kosovo"
          ]
        },
        "backSideFacts": [
          {
            "type": "CAPITAL",
            "displayValue": "Приштина",
            "observedAt": "2026-01-01",
            "source": {
              "name": "TEST_ONLY",
              "url": "https://sources.country-flags.test/test-only"
            }
          }
        ],
        "contentVersion": "test-only-fixture-v1"
      },
      "initialOrder": 0,
      "selectionReason": "OVERDUE",
      "randomSeed": "0c5f6b1c2a3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7",
      "distractorPolicyVersion": null
    }
  ],
  "summary": {
    "uniqueCardCount": 2,
    "reviewCount": 3,
    "correctCount": 2,
    "incorrectCount": 1,
    "durationSeconds": 90,
    "ratings": {
      "again": 1,
      "hard": 0,
      "good": 1,
      "easy": 1
    }
  },
  "serverTime": "2026-07-29T10:01:30.200Z"
}
"""

    static let decksJSON = """
{
  "items": [
    {
      "id": "70000000-0000-4000-8000-000000000001",
      "code": "ALL_COUNTRIES",
      "kind": "CURATED",
      "name": "Все страны",
      "description": "Полный каталог флагов",
      "cardCount": 8,
      "dueCount": 3,
      "currentMasteryTier": "BRONZE",
      "contentVersion": "test-only-fixture-v1"
    },
    {
      "id": "70000000-0000-4000-8000-000000000002",
      "code": "EUROPE",
      "kind": "TAXONOMY",
      "name": "Европа",
      "description": "Европейские и трансконтинентальные страны",
      "cardCount": 7,
      "dueCount": null,
      "contentVersion": "test-only-fixture-v1"
    }
  ],
  "page": {
    "nextCursor": null,
    "hasMore": false
  }
}
"""

    /// A deck whose kind is not one this build knows.
    static let deckWithUnknownKindJSON = """
{
  "id": "70000000-0000-4000-8000-000000000001",
  "code": "ALL_COUNTRIES",
  "kind": "SEASONAL_EVENT",
  "name": "Все страны",
  "description": "Полный каталог флагов",
  "cardCount": 8,
  "dueCount": 3,
  "currentMasteryTier": "BRONZE",
  "contentVersion": "test-only-fixture-v1"
}
"""
}
