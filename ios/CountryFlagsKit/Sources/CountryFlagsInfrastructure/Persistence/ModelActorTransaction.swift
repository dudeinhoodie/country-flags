import Foundation
import SwiftData

import CountryFlagsDomain

extension ModelActor {
    /// Runs a unit of work all-or-nothing.
    ///
    /// Autosave is disabled for the duration so nothing reaches the store
    /// before the block finished: a failure halfway through rolls the context
    /// back instead of leaving a review without its outbox entry.
    func transaction(_ work: () throws -> Void) throws {
        let context = modelContext
        let previousAutosave = context.autosaveEnabled
        context.autosaveEnabled = false
        defer { context.autosaveEnabled = previousAutosave }

        do {
            try work()
            try context.save()
        } catch {
            context.rollback()
            if let persistenceError = error as? PersistenceError {
                throw persistenceError
            }
            throw PersistenceError.transactionFailed(String(describing: error))
        }
    }
}
