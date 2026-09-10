import XCTest

import CountryFlagsMockBackend

final class MockAuthTests: XCTestCase {
    func testAnExplicitFixtureAccountIsSelected() {
        let accountID = "9F000000-0000-4000-8000-00000000000A"

        let selected = MockAuth.fixtureUserID(
            arguments: [MockAuth.fixtureAccountIDArgument, accountID]
        )

        XCTAssertEqual(selected, accountID.lowercased())
    }

    func testAnInvalidFixtureAccountFallsBackToTheDefault() {
        let selected = MockAuth.fixtureUserID(
            arguments: [MockAuth.fixtureAccountIDArgument, "not-a-uuid"]
        )

        XCTAssertEqual(selected, MockAuth.userID)
    }

    func testTheSessionBelongsToTheSelectedFixtureAccount() throws {
        let accountID = "9f000000-0000-4000-8000-00000000000b"
        let response = MockAuth.session(
            now: Date(timeIntervalSince1970: 1_800_000_000),
            userID: accountID
        )

        let body = try XCTUnwrap(response.body)
        let document = try XCTUnwrap(
            JSONSerialization.jsonObject(with: body) as? [String: Any]
        )
        let user = try XCTUnwrap(document["user"] as? [String: Any])

        XCTAssertEqual(user["id"] as? String, accountID)
    }
}
