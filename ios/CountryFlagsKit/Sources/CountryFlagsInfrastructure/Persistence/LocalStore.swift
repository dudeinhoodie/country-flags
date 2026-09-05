import Foundation
import SwiftData

import CountryFlagsDomain

/// The registry of schema versions.
///
/// A version must describe the store *as it was*, which the shared model types
/// cannot do on their own: they are the store as it is now, and a version that
/// lists one after it gains a property describes the newer shape instead of its
/// own. Two versions that describe the same shape are rejected at container
/// creation with "Duplicate version checksums detected", and a version that
/// describes a shape no store was ever written in fails the other way, with
/// "Cannot use staged migration with an unknown model version". Both are
/// Objective-C exceptions thrown before anything below can catch them, so the
/// app does not start at all. So: changing a model means freezing a copy of its
/// previous shape beside the version that last described it, the way
/// `LocalSchemaV1` holds the card and the deck progress.
///
/// Adding a version means appending it here together with its stage, which is
/// the whole point of declaring a plan before there is anything to migrate: an
/// app update must never resolve a schema change by discarding the store,
/// because an unsynchronized outbox lives in it.
enum LocalStoreMigrationPlan: SchemaMigrationPlan {
    static var schemas: [any VersionedSchema.Type] {
        [
            LocalSchemaV1.self,
            LocalSchemaV2.self,
            LocalSchemaV3.self,
            LocalSchemaV4.self,
            LocalSchemaV5.self,
            LocalSchemaV6.self,
        ]
    }

    static var stages: [MigrationStage] {
        [
            // Adding the facts a card prints on its back: a property with a
            // default, which SwiftData can apply without a device losing what
            // it has not uploaded yet.
            .lightweight(fromVersion: LocalSchemaV1.self, toVersion: LocalSchemaV2.self),
            // Adding the stored due summary: a new model, so nothing existing
            // is rewritten and the outbox crosses the update intact.
            .lightweight(fromVersion: LocalSchemaV2.self, toVersion: LocalSchemaV3.self),
            // Adding the backend's count of cards in flight: a property with a
            // default on a model version 3 froze, so SwiftData widens the table
            // and a device keeps what it has not uploaded yet.
            .lightweight(fromVersion: LocalSchemaV3.self, toVersion: LocalSchemaV4.self),
            // Adding a fact's parts beside the line the backend composed: a
            // property with a default on a model versions 1 to 4 froze, so
            // SwiftData widens the table and a device keeps what it has not
            // uploaded yet. Facts already downloaded have nil there and keep
            // showing the line they arrived as.
            .lightweight(fromVersion: LocalSchemaV4.self, toVersion: LocalSchemaV5.self),
            // Adding what opens a deck, what an administrative unit belongs
            // to, which drawing an asset is, and the three models a purchase
            // needs to outlive the launch it was made in. Every added property
            // has a default and the three models are new, so SwiftData widens
            // the tables and creates the rest — the review outbox and any
            // session still open cross the update untouched. A deck stored
            // before this reads as `FREE`, which is what it is.
            .lightweight(fromVersion: LocalSchemaV5.self, toVersion: LocalSchemaV6.self),
        ]
    }
}

/// Creates the store the app and the tests use.
public struct LocalStore: Sendable {
    public enum Location: Sendable {
        /// Survives relaunch. The name separates a build's store from another
        /// build's on the same device.
        case onDisk(name: String)
        /// Discarded with the process; used by tests that do not exercise
        /// persistence across launches.
        case inMemory
    }

    public let container: ModelContainer

    public init(location: Location = .onDisk(name: "CountryFlags")) throws {
        let schema = Schema(versionedSchema: LocalSchemaV6.self)
        let configuration: ModelConfiguration
        switch location {
        case .inMemory:
            configuration = ModelConfiguration(
                schema: schema,
                isStoredInMemoryOnly: true
            )
        case .onDisk(let name):
            configuration = ModelConfiguration(
                name,
                schema: schema,
                isStoredInMemoryOnly: false
            )
        }

        do {
            container = try ModelContainer(
                for: schema,
                migrationPlan: LocalStoreMigrationPlan.self,
                configurations: configuration
            )
        } catch {
            // Falling back to a fresh store here would silently drop reviews
            // the user already made and never uploaded.
            throw PersistenceError.storeUnavailable(String(describing: error))
        }
    }

    /// Builds a store at an explicit file URL, which is what a migration or a
    /// relaunch test needs.
    public init(fileURL: URL) throws {
        let schema = Schema(versionedSchema: LocalSchemaV6.self)
        do {
            container = try ModelContainer(
                for: schema,
                migrationPlan: LocalStoreMigrationPlan.self,
                configurations: ModelConfiguration(schema: schema, url: fileURL)
            )
        } catch {
            throw PersistenceError.storeUnavailable(String(describing: error))
        }
    }

    public func makeContentRepository() -> some ContentRepository {
        SwiftDataContentRepository(modelContainer: container)
    }

    public func makeLearningRepository() -> some LearningRepository {
        SwiftDataLearningRepository(modelContainer: container)
    }

    public func makeOutboxRepository() -> some OutboxRepository {
        SwiftDataOutboxRepository(modelContainer: container)
    }

    public func makeTelemetryRepository() -> some TelemetryRepository {
        SwiftDataTelemetryRepository(modelContainer: container)
    }

    public func makeCommerceRepository() -> some CommerceRepository {
        SwiftDataCommerceRepository(modelContainer: container)
    }

    public func makeAccountScopeCleaner() -> some AccountScopeCleaner {
        SwiftDataAccountScopeCleaner(modelContainer: container)
    }

    /// The files backing a named store.
    ///
    /// Xcode builds a local package in release for every configuration that is
    /// not named "Debug", so a `#if DEBUG` inside the package would not track
    /// the app's own Debug flag. The reset therefore lives in the app target,
    /// which only needs to know which files to remove before the store is
    /// opened.
    public static func fileURLs(forName name: String) -> [URL] {
        let base = ModelConfiguration(name, schema: Schema(versionedSchema: LocalSchemaV6.self))
            .url
        // SQLite keeps its write-ahead log and shared memory next to the store.
        return [base]
            + ["-wal", "-shm"].map {
                base.deletingLastPathComponent()
                    .appendingPathComponent(base.lastPathComponent + $0)
            }
    }
}
