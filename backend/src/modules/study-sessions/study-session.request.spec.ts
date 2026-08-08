import { parseCompleteStudySessionRequest } from "./study-session.request";

describe("parseCompleteStudySessionRequest", () => {
  it("accepts the canonical completion body", () => {
    expect(
      parseCompleteStudySessionRequest({
        completedAt: "2026-07-29T10:02:30.000Z",
      }),
    ).toEqual({ completedAt: new Date("2026-07-29T10:02:30.000Z") });
  });

  it.each([
    ["a non-object body", "completedAt"],
    ["a missing field", {}],
    ["an unknown field", { completedAt: "2026-07-29T10:02:30.000Z", n: 1 }],
    ["a non date-time value", { completedAt: "yesterday" }],
    ["a numeric value", { completedAt: 1_760_000_000 }],
  ])("rejects %s", (_case, body) => {
    expect(() => parseCompleteStudySessionRequest(body)).toThrow();
  });
});
