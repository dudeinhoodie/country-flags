import Foundation
import SwiftData

/// Version 2 of the local store: a learning card carries the facts printed on
/// its back.
///
/// The change is additive — one property with a default on
/// `StoredLearningCard` — so the stage is lightweight and the models are the
/// ones version 1 already listed. Declaring the same types in both versions is
/// what an additive change looks like: what tells the two apart is the version
/// identifier written into the store, which is what SwiftData migrates from.
/// A version that changes the shape of an existing property, or moves data
/// between models, cannot be expressed this way and will need its own copies of
/// the model definitions and a custom stage.
enum LocalSchemaV2: VersionedSchema {
    static var versionIdentifier: Schema.Version { Schema.Version(2, 0, 0) }

    static var models: [any PersistentModel.Type] { LocalSchemaV1.models }
}
