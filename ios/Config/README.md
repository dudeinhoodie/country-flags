# Build configuration

`Base.xcconfig` and the per-environment files it is layered under decide what
each build talks to; `App-Info.plist` and `CountryFlags.entitlements` decide
what it declares. Nothing here is a target member, which is the point: these
files are read by the build system and by schemes, never copied into a bundle.

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

Both problems have the same fix, and it is not a small one: a unit-test target
inside `CountryFlags.xcodeproj` with the app as its test host. That is a
project change worth making deliberately rather than as a side effect of a
feature. Until then the store's own behaviour is exercised by hand through
this file and the Mock scheme, and everything the app decides about a purchase
— the settle order, what opens a deck, what a paywall may say, what a
revocation does — is tested without a store in `PurchaseCoordinatorTests` and
`CommerceCenterTests`.
