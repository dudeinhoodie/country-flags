import { AdminRole } from "@prisma/client";

import { roleSatisfies } from "./admin-roles";

describe("roleSatisfies", () => {
  const ladder = [
    AdminRole.VIEWER,
    AdminRole.EDITOR,
    AdminRole.PUBLISHER,
    AdminRole.ADMIN,
  ];

  it("lets every role act at or below its own rank", () => {
    for (const [actualIndex, actual] of ladder.entries()) {
      for (const [requiredIndex, required] of ladder.entries()) {
        expect(roleSatisfies(actual, required)).toBe(
          actualIndex >= requiredIndex,
        );
      }
    }
  });
});
