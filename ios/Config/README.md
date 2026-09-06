# Build configuration

`Base.xcconfig` and the per-environment files it is layered under decide what
each build talks to; `App-Info.plist` and `CountryFlags.entitlements` decide
what it declares. Nothing here is a target member, which is the point: these
files are read by the build system and by schemes, never copied into a bundle.

Two of the files describe a target rather than an environment, and sit above
the environment ones:

| File              | Read by              | Holds                                     |
| ----------------- | -------------------- | ----------------------------------------- |
| `Base.xcconfig`   | everything           | settings no configuration changes         |
| `Mock/Dev/Prod`   | the project          | the endpoint, the name, the optimizer     |
| `App.xcconfig`    | both app targets     | what makes a target the app               |
| `AppMock.xcconfig` | `CountryFlagsAppMock` | the mock backend on top of `App.xcconfig` |

## Why there are two app targets

`CountryFlagsApp` ships. `CountryFlagsAppMock` is the same sources plus the
`CountryFlagsMockBackend` package product, and it is what the `CountryFlags-Mock`
scheme runs and the UI tests drive.

They exist separately because linking is a property of a target and not of a
configuration. Xcode links every Swift package product a target depends on
whatever configuration it is building, and copies that product's resources into
the app beside it — so while the app had one target, an App Store build carried
the mock catalogue, the fixture strings and the unreachable host `mock.invalid`,
1.3 MB of them, with no code path able to reach any of it. Nothing conditional
in the project file can undo that; only a target that does not depend on the
module can. `Scripts/check-release-app.sh` reads a built app and fails if any
of it comes back.

The cost of a second target is a place for the two to drift, and that is what
`App.xcconfig` is for: everything the two app targets share is written once and
neither target's build configurations carry settings of their own — including
`MARKETING_VERSION`, which a release raises there rather than in the project
file. `Scripts/check-signing-entitlements.sh` resolves the setting per target
and per configuration, so a target that stopped reading the file is a failure
rather than a surprise on a device.

The app tells the two apart with `MOCK_BACKEND`, defined by `AppMock.xcconfig`.
It is deliberately not `DEBUG`: Dev is a debug build too, and it links no mock.

## `CountryFlags.storekit`

What the app sells, in the form Xcode's simulator store understands: the two
production deck identifiers and the one the Mock build sells. The
`CountryFlags-Mock` scheme points its `StoreKitConfigurationFileReference` at
it, so running that scheme in the simulator gives a store that answers —
products resolve, prices are formatted, and a purchase can be completed.

It belongs to no target. That is what keeps it out of every shipped binary,
and it is the reason the file lives here rather than beside the app sources,
which are a file-system-synchronized group and would adopt it automatically.

### Why there are no `StoreKitTest` cases against it

There were, and they did not survive contact with CI. `SKTestSession` reads
this file happily from a SwiftPM test bundle on a developer machine, and on a
clean runner it never offers the products at all — a sixty-second wait for
them expired twice. Completing a purchase fails there for a plainer reason:
neither `Product.purchase()` nor `SKTestSession.buyProduct` will finish one
without a host application, because there is no window scene for the store to
transact in, and both answer `StoreKitError.unknown`.

Both problems have the same fix: a unit-test target inside
`CountryFlags.xcodeproj` with an app as its test host. That is a project change
worth making deliberately rather than as a side effect of a feature, and it is
now a smaller one than it was — the project has a second application target,
`CountryFlagsAppMock`, which already builds the app with a store to talk to and
is already what the UI tests launch. A `StoreKitTest` target hosted by it is the
next piece, not a new kind of piece. Until then the store's own behaviour is
exercised by hand through
this file and the Mock scheme, and everything the app decides about a purchase
— the settle order, what opens a deck, what a paywall may say, what a
revocation does — is tested without a store in `PurchaseCoordinatorTests` and
`CommerceCenterTests`.
