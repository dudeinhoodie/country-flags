import Foundation

import CountryFlagsDomain

/// Access to the string catalog of the package.
///
/// Keys are listed here instead of being spread across views: a missing
/// translation shows up in one place and `Bundle.module` is not repeated at
/// every call site.
public enum L10n {
    public static var shellTitle: String {
        localized("shell.title")
    }

    public static var shellSubtitle: String {
        localized("shell.subtitle")
    }

    public static var shellOpenSettings: String {
        localized("shell.open_settings")
    }

    public static var settingsTitle: String {
        localized("settings.title")
    }

    public static var catalogTitle: String {
        localized("catalog.title")
    }

    public static var progressTitle: String {
        localized("progress.title")
    }

    public static var deckTitle: String {
        localized("deck.title")
    }

    public static var advertisementLabel: String {
        localized("ads.slot.label")
    }

    // MARK: - Content

    public static var homeTitle: String { localized("home.title") }
    public static var homeGreeting: String { localized("home.greeting") }
    public static var homeRecommended: String { localized("home.recommended") }
    public static var homeOpenCatalog: String { localized("home.open_catalog") }
    /// The label over the number the first screen is built around, in each of
    /// its two cases, and the action underneath it.
    public static var homeDue: String { localized("home.due") }
    public static var homeDueEmpty: String { localized("home.due_empty") }

    public static func homeDueCount(_ count: Int) -> String {
        String(format: localized("home.due_count"), count)
    }
    public static var homeDeckSize: String { localized("home.deck_size") }
    public static var homeContinue: String { localized("home.continue") }
    public static var homeSessionInProgress: String { localized("home.session_in_progress") }

    public static var catalogSearchPrompt: String { localized("catalog.search_prompt") }
    public static var catalogNoMatches: String { localized("catalog.no_matches") }
    public static var catalogSectionCurated: String { localized("catalog.section.curated") }
    public static var catalogSectionRegions: String { localized("catalog.section.regions") }
    public static var catalogSectionPersonal: String { localized("catalog.section.personal") }

    /// Names the language the catalog is actually in, for the case where the
    /// device asked for one the release does not publish.
    public static func catalogLocaleFallback(_ locale: String) -> String {
        String(format: localized("catalog.locale_fallback"), locale)
    }

    public static var deckCountriesSection: String { localized("deck.countries") }
    public static var deckSearchPrompt: String { localized("deck.search_prompt") }
    public static var deckNoMatches: String { localized("deck.no_matches") }

    public static func deckCardCount(_ count: Int) -> String {
        String(format: localized("deck.card_count"), count)
    }

    public static var homeOpenProgress: String { localized("home.open_progress") }

    public static var progressDecksSection: String { localized("progress.decks") }
    public static var progressStudiedLabel: String { localized("progress.studied") }
    public static var progressAchievementsSection: String { localized("progress.achievements") }
    public static var progressEmptyTitle: String { localized("progress.empty.title") }
    public static var progressEmptyBody: String { localized("progress.empty.body") }

    public static func progressDeckCounts(_ started: Int, _ total: Int) -> String {
        String(format: localized("progress.deck_counts"), started, total)
    }

    public static func progressDeckDue(_ due: Int) -> String {
        String(format: localized("progress.deck_due"), due)
    }

    public static var masteryNone: String { localized("mastery.none") }
    public static var masteryBronze: String { localized("mastery.bronze") }
    public static var masterySilver: String { localized("mastery.silver") }
    public static var masteryGold: String { localized("mastery.gold") }
    public static var masteryPlatinum: String { localized("mastery.platinum") }

    public static var settingsSessionSection: String { localized("settings.session") }
    public static var settingsFeedbackSection: String { localized("settings.feedback") }
    public static var settingsSound: String { localized("settings.sound") }
    public static var settingsHaptics: String { localized("settings.haptics") }
    public static var settingsRemindersSection: String { localized("settings.reminders_section") }
    public static var settingsReminders: String { localized("settings.reminders") }
    public static var settingsRemindersFooter: String { localized("settings.reminders_footer") }
    public static var settingsConflictReloaded: String { localized("settings.conflict_reloaded") }

    // MARK: - Account

    public static var accountSection: String { localized("account.section") }
    public static var accountSignedIn: String { localized("account.signed_in") }
    public static var accountExpired: String { localized("account.expired") }
    public static var accountSignOut: String { localized("account.sign_out") }
    public static var accountSignOutEverywhere: String { localized("account.sign_out_everywhere") }
    public static var accountSignOutClean: String { localized("account.sign_out_clean") }
    public static var accountCancel: String { localized("account.cancel") }
    public static var accountSigningIn: String { localized("account.signing_in") }
    public static var accountMigrationPending: String { localized("account.migration_pending") }
    public static var accountMigrationFailed: String { localized("account.migration_failed") }
    public static var accountSignInFailed: String { localized("account.sign_in_failed") }
    public static var accountSignInOffline: String { localized("account.sign_in_offline") }
    public static var accountGuestNote: String { localized("account.guest_note") }
    public static var accountSignInGoogle: String { localized("account.sign_in_google") }
    public static var accountFallbackName: String { localized("account.fallback_name") }

    public static func accountSignOutWarning(_ count: Int) -> String {
        String(format: localized("account.sign_out_warning"), count)
    }

    public static func accountMigrationImported(_ count: Int) -> String {
        String(format: localized("account.migration_imported"), count)
    }

    public static var contentLoading: String { localized("content.loading") }
    public static var contentRetry: String { localized("content.retry") }
    public static var contentStale: String { localized("content.stale") }
    public static var contentOffline: String { localized("content.offline") }
    public static var contentRefreshFailed: String { localized("content.refresh_failed") }
    public static var contentClientTooOld: String { localized("content.client_too_old") }
    public static var contentEmptyTitle: String { localized("content.empty.title") }
    public static var contentEmptyMessage: String { localized("content.empty.message") }
    public static var contentOfflineTitle: String { localized("content.offline.title") }
    public static var contentOfflineMessage: String { localized("content.offline.message") }
    public static var contentFailedTitle: String { localized("content.failed.title") }
    public static var contentFailedMessage: String { localized("content.failed.message") }
    public static var contentClientTooOldTitle: String { localized("content.client_too_old.title") }
    public static var contentClientTooOldMessage: String {
        localized("content.client_too_old.message")
    }

    // MARK: - Study

    public static var studyTitle: String { localized("study.title") }
    public static var studyReveal: String { localized("study.reveal") }
    public static var studyFlagPrompt: String { localized("study.flag_prompt") }
    public static var studyDetails: String { localized("study.details") }
    public static var studyDetailsTitle: String { localized("study.details.title") }
    public static var studyClose: String { localized("study.close") }
    public static var studyCardHint: String { localized("study.card.hint") }
    public static var studyMapOpen: String { localized("study.map.open") }
    public static var studyNotSaved: String { localized("study.not_saved") }
    public static var studyNoCards: String { localized("study.no_cards") }
    public static var studyStoreUnavailable: String { localized("study.store_unavailable") }
    public static var studyResultTitle: String { localized("study.result.title") }
    public static var studyResultDone: String { localized("study.result.done") }
    public static var studyStart: String { localized("study.start") }
    public static var studySessionSize: String { localized("study.session_size") }

    public static func studyProgress(_ position: Int, _ total: Int) -> String {
        String(format: localized("study.progress"), position, total)
    }

    public static func studyResultAnswered(_ answered: Int, _ planned: Int) -> String {
        String(format: localized("study.result.answered"), answered, planned)
    }

    public static func studyRating(_ rating: StudyRating) -> String {
        localized("study.rating.\(rating.rawValue.lowercased())")
    }

    /// The name of a fact type, or nil for one this build has no name for.
    /// The release decides which types it publishes, and an unnamed type is
    /// shown as its value alone rather than dropped or labelled with its code.
    public static func factType(_ type: String) -> String? {
        switch type.uppercased() {
        case "CAPITAL": localized("fact.capital")
        case "POPULATION": localized("fact.population")
        case "CURRENCY": localized("fact.currency")
        case "LANGUAGE": localized("fact.language")
        case "AREA": localized("fact.area")
        default: nil
        }
    }

    public static var studyObjectiveTitle: String { localized("study.objective.title") }
    public static var studyNext: String { localized("study.next") }
    public static var studyModeSection: String { localized("study.mode") }
    public static var studyModeSelfRated: String { localized("study.mode.self_rated") }
    public static var studyModeObjective: String { localized("study.mode.objective") }
    public static var studyNoDistractorsTitle: String { localized("study.no_distractors.title") }
    public static var studyNoDistractorsMessage: String {
        localized("study.no_distractors.message")
    }

    public static func studyObjectiveScore(_ correct: Int, _ answered: Int) -> String {
        String(format: localized("study.objective.score"), correct, answered)
    }

    /// Spoken after an answer. The outcome is in the words, not only in the
    /// colour behind them.
    public static func studyOptionCorrect(_ name: String) -> String {
        String(format: localized("study.option.correct"), name)
    }

    public static func studyOptionIncorrect(_ name: String) -> String {
        String(format: localized("study.option.incorrect"), name)
    }

    public static var syncOffline: String { localized("sync.offline") }
    public static var syncRetryLater: String { localized("sync.retry_later") }
    public static var syncSignInRequired: String { localized("sync.sign_in_required") }

    public static func syncPending(_ count: Int) -> String {
        String(format: localized("sync.pending"), count)
    }

    /// A guest's work is saved and simply not sent yet. Saying it failed would
    /// be false and would invite them to retry something that is not broken.
    public static func syncSavedOnDevice(_ count: Int) -> String {
        String(format: localized("sync.saved_on_device"), count)
    }

    /// The copy a failure is allowed to show.
    ///
    /// It is chosen from the kind, never taken from the response: an error
    /// envelope is written for whoever reads the backend logs and can name an
    /// internal rule, a provider or a record.
    public static func errorMessage(for kind: PresentableError.Kind) -> String {
        localized("error.\(kind.rawValue)")
    }

    /// The line that carries the identifier support needs.
    public static func errorSupportReference(_ requestID: String) -> String {
        String(
            format: localized("error.support_reference"),
            requestID
        )
    }

    /// The resource bundle of the package. Tests use it to verify that the
    /// string catalog is actually compiled instead of falling back to keys.
    static var bundle: Bundle { .module }

    static func localized(_ key: String) -> String {
        String(localized: String.LocalizationValue(key), bundle: bundle)
    }
}
