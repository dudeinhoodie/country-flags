import Foundation
import SwiftData

/// Version 4 of the local store: a deck's progress keeps the backend's own
/// count of cards still settling.
///
/// One property with a default on a model that already existed — no type
/// changes, nothing renamed — so the stage is lightweight and a device carries
/// its unsynchronized outbox across the update untouched. The number is filled
/// by the next sync; until then it is zero, which reads as "nothing in flight"
/// rather than as a wrong answer.
enum LocalSchemaV4: VersionedSchema {
    static var versionIdentifier: Schema.Version { Schema.Version(4, 0, 0) }

    /// The same list as version 3: this version changes a model rather than
    /// adding one, and the list is repeated so the difference between versions
    /// stays legible in one place.
    static var models: [any PersistentModel.Type] { LocalSchemaV3.models }
}
