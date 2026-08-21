import Foundation
import SwiftData

import CountryFlagsDomain

/// The registry of schema versions.
///
/// Adding a version means appending it here together with its stage, which is
/// the whole point of declaring a plan before there is anything to migrate: an
/// app update must never resolve a schema change by discarding the store,
/// because an unsynchronized outbox lives in it.
enum LocalStoreMigrationPlan: SchemaMigrationPlan {
    static var schemas: [any VersionedSchema.Type] {
        [LocalSchemaV1.self, LocalSchemaV2.self, LocalSchemaV3.self, LocalSchemaV4.self]
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
            // default on an existing model, which SwiftData fills without
            // rewriting anything a device has not uploaded.
            .lightweight(fromVersion: LocalSchemaV3.self, toVersion: LocalSchemaV4.self),
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
        let schema = Schema(versionedSchema: LocalSchemaV4.self)
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
        let schema = Schema(versionedSchema: LocalSchemaV4.self)
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
        let base = ModelConfiguration(name, schema: Schema(versionedSchema: LocalSchemaV4.self))
            .url
        // SQLite keeps its write-ahead log and shared memory next to the store.
        return [base]
            + ["-wal", "-shm"].map {
                base.deletingLastPathComponent()
                    .appendingPathComponent(base.lastPathComponent + $0)
            }
    }
}
