import { parseDeleteProgressRequest } from "./delete-progress.request";

describe("parseDeleteProgressRequest", () => {
  it("accepts the exact confirmation constant", () => {
    expect(
      parseDeleteProgressRequest({ confirmation: "DELETE_PROGRESS" }),
    ).toEqual({ confirmation: "DELETE_PROGRESS" });
  });

  it.each([
    ["an empty body", {}],
    ["a different constant", { confirmation: "DELETE_ACCOUNT" }],
    ["a lowercase constant", { confirmation: "delete_progress" }],
    ["a non-string value", { confirmation: true }],
    ["an extra field", { confirmation: "DELETE_PROGRESS", force: true }],
    ["an array body", []],
  ])("rejects %s", (_case, body) => {
    expect(() => parseDeleteProgressRequest(body)).toThrow();
  });
});
