import { GeoEntityKind } from "@prisma/client";

import {
  DISTRACTOR_POLICY_VERSION,
  type DistractorPoolEntity,
  generateMultipleChoiceOptions,
} from "./multiple-choice-options";

function entity(suffix: number, en: string, ru: string): DistractorPoolEntity {
  return {
    id: `30000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`,
    kind: GeoEntityKind.COUNTRY,
    names: [
      { locale: "en", value: en, isPrimary: true },
      { locale: "ru", value: ru, isPrimary: true },
    ],
  };
}

describe("generateMultipleChoiceOptions", () => {
  const pool = [
    entity(1, "Belgium", "Бельгия"),
    entity(2, "France", "Франция"),
    entity(3, "Germany", "Германия"),
    entity(4, "Nepal", "Непал"),
    entity(5, "Switzerland", "Швейцария"),
  ];
  const input = {
    sessionCardId: "90000000-0000-4000-8000-000000000001",
    correctEntityId: pool[0]!.id,
    correctEntityKind: GeoEntityKind.COUNTRY,
    requestedLocale: "en-US",
    defaultLocale: "ru",
    randomSeed: "deterministic-seed",
    poolVersion: "content-v7",
    pool,
  };

  it("creates a deterministic versioned snapshot with four unique options", () => {
    const first = generateMultipleChoiceOptions(input);
    const second = generateMultipleChoiceOptions({
      ...input,
      pool: [...pool].reverse(),
    });

    expect(second).toEqual(first);
    expect(first?.distractorPolicyVersion).toBe(
      `${DISTRACTOR_POLICY_VERSION}@content-v7`,
    );
    expect(first?.options).toHaveLength(4);
    expect(first?.options.map(({ position }) => position)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(new Set(first?.options.map(({ id }) => id)).size).toBe(4);
    expect(
      new Set(first?.options.map(({ answerEntityId }) => answerEntityId)).size,
    ).toBe(4);
    expect(first?.options.filter(({ isCorrect }) => isCorrect)).toHaveLength(1);
    expect(
      first?.options.every(
        ({ displaySnapshot }) => displaySnapshot.locale === "en",
      ),
    ).toBe(true);
  });

  it("uses the manifest default locale when the requested locale is unavailable", () => {
    const result = generateMultipleChoiceOptions({
      ...input,
      requestedLocale: "de-DE",
    });

    expect(
      result?.options.every(
        ({ displaySnapshot }) => displaySnapshot.locale === "ru",
      ),
    ).toBe(true);
    expect(
      result?.options.map(({ displaySnapshot }) => displaySnapshot.displayName),
    ).toEqual(expect.arrayContaining(["Бельгия"]));
  });

  it("returns a predictable fallback when three unique names are unavailable", () => {
    const duplicatePool = [
      entity(1, "Same", "Одинаково"),
      entity(2, "Same", "Одинаково"),
      entity(3, "Same", "Одинаково"),
      entity(4, "Other", "Другое"),
    ];

    expect(
      generateMultipleChoiceOptions({
        ...input,
        correctEntityId: duplicatePool[0]!.id,
        pool: duplicatePool,
      }),
    ).toBeNull();
  });
});
