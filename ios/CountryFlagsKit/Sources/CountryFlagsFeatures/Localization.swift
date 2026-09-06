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

    /// The launch wait, in two kinds. Nothing has been read yet, and the
    /// flags themselves are coming — everyone's first launch, and the only
    /// wait a guest ever sees; or an account's numbers, which are the
    /// backend's (ADR-016), have never arrived. Naming an account to someone
    /// who has none describes work that is not happening.
    public static var launchCatalogTitle: String { localized("launch.catalog.title") }
    public static var launchCatalogSubtitle: String {
        localized("launch.catalog.subtitle")
    }
    public static var launchCatalogFailedSubtitle: String {
        localized("launch.catalog.failed.subtitle")
    }
    public static var launchAccountTitle: String { localized("launch.account.title") }
    public static var launchAccountSubtitle: String {
        localized("launch.account.subtitle")
    }
    public static var launchAccountFailedSubtitle: String {
        localized("launch.account.failed.subtitle")
    }
    /// The server is what could not be reached whichever wait it interrupted.
    public static var launchFailedTitle: String { localized("launch.failed.title") }
    public static var launchRetry: String { localized("launch.retry") }

    public static var homeTitle: String { localized("home.title") }
    public static var homeLoading: String { localized("home.loading") }
    public static var homeRecommended: String { localized("home.recommended") }
    public static var homeOpenCatalog: String { localized("home.open_catalog") }
    /// The label over the number the first screen is built around, in each of
    /// its two cases, and the action underneath it.
    public static var homeDue: String { localized("home.due") }
    /// The cleared-day card: a learner who finished everything is told so,
    /// shown what it added up to, and offered somewhere to go next.
    public static var homeClearedSubtitle: String { localized("home.cleared.subtitle") }
    public static var homeClearedLearned: String { localized("home.cleared.learned") }
    public static var homeClearedInProgress: String { localized("home.cleared.in_progress") }
    /// Declined by the count, which is why it goes through the catalogue's own
    /// plural machinery rather than a format string: "1 страна", "2 страны",
    /// "12 стран" are three different words.
    public static func homeClearedInProgressCount(_ count: Int) -> String {
        // `NSLocalizedString` returns the plural rule itself; only
        // `localizedStringWithFormat` applies it. `String(localized:)` would
        // hand back one arbitrary variant and format the number into it.
        String.localizedStringWithFormat(
            NSLocalizedString("home.cleared.in_progress_count", bundle: bundle, comment: ""),
            count
        )
    }

    public static func homeDueCount(_ count: Int) -> String {
        String(format: localized("home.due_count"), count)
    }
    public static var homeDeckSize: String { localized("home.deck_size") }
    public static var homeContinue: String { localized("home.continue") }
    public static var homeSessionInProgress: String { localized("home.session_in_progress") }
    public static func homeSessionLeft(_ count: Int) -> String {
        String(format: localized("home.session_left"), count)
    }
    public static var homeDueToday: String { localized("home.due_today") }

    /// The backend's breakdown of the queue, one part each. They are joined by
    /// the view rather than formatted as one string, so a part with nothing in
    /// it is left out instead of being printed as a zero.
    public static func homeDueOverdue(_ count: Int) -> String {
        String(format: localized("home.due_overdue"), count)
    }

    public static func homeDueLearning(_ count: Int) -> String {
        String(format: localized("home.due_learning"), count)
    }

    public static func homeDueNew(_ count: Int) -> String {
        String(format: localized("home.due_new"), count)
    }
    public static var homeReview: String { localized("home.review") }

    public static var catalogSearchPrompt: String { localized("catalog.search_prompt") }
    public static var catalogNoMatches: String { localized("catalog.no_matches") }

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

    public static var achievementsTitle: String { localized("achievements.title") }
    public static var achievementsEarned: String { localized("achievements.earned") }
    public static var achievementsEmpty: String { localized("achievements.empty") }

    public static var progressLearnedLabel: String { localized("progress.learned") }
    public static var progressMapHint: String { localized("progress.map_hint") }
    public static var detailsRegion: String { localized("details.region") }
    /// The heading over a subject's facts. Which of the two is used says what
    /// kind of subject the sheet is about — a country, or one of its states.
    public static var detailsCountryFacts: String { localized("details.facts.country") }
    public static var detailsStateFacts: String { localized("details.facts.state") }
    /// The country an administrative unit belongs to.
    public static var detailsParentCountry: String { localized("details.parent_country") }
    /// The story of the symbol, when the release publishes one. Which of the
    /// two is used follows the drawing the sheet was opened from: a flag has
    /// a history as much as an emblem does, and calling one the other would
    /// be wrong about the picture on the screen.
    public static var detailsSymbolStory: String { localized("details.symbol_story") }
    public static var detailsSymbolStoryFlag: String { localized("details.symbol_story.flag") }
    /// What the drawing is called, under a heading that has already said
    /// which drawing it is.
    public static var detailsSymbolName: String { localized("details.symbol_name") }
    public static func detailsAlsoKnown(_ names: String) -> String {
        String(format: localized("details.also_known"), names)
    }
    public static var progressInProgressLabel: String { localized("progress.state_in_progress") }
    public static var progressNotStartedLabel: String { localized("progress.state_not_started") }
    public static var progressReviewDue: String { localized("progress.review_due") }

    public static func progressReviewAt(_ moment: String) -> String {
        String(format: localized("progress.review_at"), moment)
    }

    public static func progressDeckLearned(_ count: Int) -> String {
        String(format: localized("progress.deck_learned"), count)
    }
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
    /// Offered when the account wants reminders and this device has never been
    /// asked — a setting that travelled here is not a permission.
    public static var settingsRemindersAllow: String { localized("settings.reminders_allow") }
    /// Shown when the system holds the permission and the app cannot ask
    /// again: the only way back is System Settings.
    public static var settingsRemindersDenied: String { localized("settings.reminders_denied") }
    public static var settingsOpenSystemSettings: String {
        localized("settings.open_system_settings")
    }
    public static var settingsConflictReloaded: String { localized("settings.conflict_reloaded") }

    // MARK: - Privacy

    public static var privacySection: String { localized("privacy.section") }
    public static var privacyProductAnalytics: String { localized("privacy.product_analytics") }
    public static var privacyDiagnostics: String { localized("privacy.diagnostics") }
    public static var privacyFooter: String { localized("privacy.footer") }

    /// What the daily reminder itself says. It belongs to this layer because
    /// the notification is scheduled from here; the scheduler is handed the
    /// finished strings rather than a bundle to look them up in.
    public static var reminderTitle: String { localized("reminder.title") }
    public static var reminderBody: String { localized("reminder.body") }

    // MARK: - Clearing progress

    public static var settingsProgressSection: String { localized("settings.progress_section") }
    public static var settingsClearProgress: String { localized("settings.clear_progress") }
    public static var settingsClearProgressTitle: String {
        localized("settings.clear_progress.title")
    }
    public static var settingsClearProgressBody: String {
        localized("settings.clear_progress.body")
    }
    public static var settingsClearProgressConfirm: String {
        localized("settings.clear_progress.confirm")
    }
    public static var settingsClearProgressReauth: String {
        localized("settings.clear_progress.reauth")
    }
    public static var settingsClearProgressWorking: String {
        localized("settings.clear_progress.working")
    }
    public static var settingsClearProgressDone: String {
        localized("settings.clear_progress.done")
    }
    public static var settingsClearProgressFailed: String {
        localized("settings.clear_progress.failed")
    }
    public static var settingsClearProgressReauthFailed: String {
        localized("settings.clear_progress.reauth_failed")
    }

    // MARK: - Account

    public static var accountSection: String { localized("account.section") }
    /// The same section, headed by what it offers rather than by what it is
    /// about, for somebody who has no account yet. "Account" over a pair of
    /// sign-in buttons, on a screen already titled Account, says nothing.
    public static var accountSignInSection: String { localized("account.sign_in_section") }
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

    // MARK: - The account screen

    public static var accountTitle: String { localized("account.title") }
    public static var accountOpen: String { localized("account.open") }
    public static var accountIdentitiesSection: String { localized("account.identities_section") }
    public static var accountIdentitiesFooter: String { localized("account.identities_footer") }
    public static var accountUnlink: String { localized("account.unlink") }
    public static var accountProviderApple: String { localized("account.provider_apple") }
    public static var accountProviderGoogle: String { localized("account.provider_google") }
    public static var accountDevicesSection: String { localized("account.devices_section") }
    public static var accountDevicesFooter: String { localized("account.devices_footer") }
    public static var accountThisDevice: String { localized("account.this_device") }
    public static var accountRevokeDevice: String { localized("account.revoke_device") }
    public static var accountExportSection: String { localized("account.export_section") }
    public static var accountExportFooter: String { localized("account.export_footer") }
    public static var accountExportRequest: String { localized("account.export_request") }
    public static var accountExportPreparing: String { localized("account.export_preparing") }
    public static var accountExportShare: String { localized("account.export_share") }
    public static var accountExportFailed: String { localized("account.export_failed") }
    public static var accountLegalSection: String { localized("account.legal_section") }
    /// The about screen: which build this is, and whose work it carries.
    public static var aboutTitle: String { localized("about.title") }
    public static var aboutVersion: String { localized("about.version") }
    public static var aboutBuild: String { localized("about.build") }
    public static var aboutCreditsSection: String { localized("about.credits") }
    public static var settingsAbout: String { localized("settings.about") }

    /// What a guest stands to lose, said with the number when there is one.
    /// Declined by the count — "1 выученная страна", "2 выученные страны",
    /// "96 выученных стран" are three different words — so it goes through
    /// the catalogue's plural machinery rather than a format string.
    public static func accountGuestNoteCount(_ count: Int) -> String {
        String.localizedStringWithFormat(
            NSLocalizedString("account.guest_note_count", bundle: bundle, comment: ""),
            count
        )
    }

    public static var accountPrivacyPolicy: String { localized("account.privacy_policy") }
    public static var accountTerms: String { localized("account.terms") }
    public static var accountDangerSection: String { localized("account.danger_section") }
    public static var accountDelete: String { localized("account.delete") }
    public static var accountDeleteTitle: String { localized("account.delete.title") }
    public static var accountDeleteBody: String { localized("account.delete.body") }
    public static var accountDeleteConfirm: String { localized("account.delete.confirm") }
    public static var accountDeleteWorking: String { localized("account.delete.working") }
    public static var accountDeleteFailed: String { localized("account.delete.failed") }
    public static var accountDeletionPendingTitle: String {
        localized("account.deletion_pending.title")
    }
    public static var accountProveTitle: String { localized("account.prove.title") }
    public static var accountProveBody: String { localized("account.prove.body") }
    public static var accountProveFailed: String { localized("account.prove.failed") }
    public static var accountIdentityTakenTitle: String {
        localized("account.identity_taken.title")
    }
    public static var accountIdentityTakenBody: String { localized("account.identity_taken.body") }
    public static var accountIdentityFailedTitle: String {
        localized("account.identity_failed.title")
    }
    public static var accountIdentityDuplicateBody: String {
        localized("account.identity_duplicate.body")
    }
    public static var accountIdentityLastBody: String { localized("account.identity_last.body") }
    public static var accountIdentityOfflineBody: String {
        localized("account.identity_offline.body")
    }
    public static var accountIdentityRefusedBody: String {
        localized("account.identity_refused.body")
    }
    public static var accountSwitchAccounts: String { localized("account.switch_accounts") }

    public static func accountIdentityLastUsed(_ day: String) -> String {
        String(format: localized("account.identity_last_used"), day)
    }

    public static func accountDeviceDetails(_ version: String, _ day: String) -> String {
        String(format: localized("account.device_details"), version, day)
    }

    public static func accountDeletionPendingBody(_ day: String) -> String {
        String(format: localized("account.deletion_pending.body"), day)
    }

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
    public static var studyHide: String { localized("study.hide") }
    public static var studyFlagPrompt: String { localized("study.flag_prompt") }
    /// What VoiceOver calls a coat of arms while the question is still open.
    /// It names the kind of symbol and never the country, for the same reason
    /// the flag's prompt does not.
    public static var studyCoatPrompt: String { localized("study.coat_prompt") }
    public static var studyCardUnsupportedTitle: String {
        localized("study.card.unsupported.title")
    }
    public static var studyCardUnsupportedMessage: String {
        localized("study.card.unsupported.message")
    }
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

    public static var studyResultExcellent: String { localized("study.result.excellent") }
    public static var studyStart: String { localized("study.start") }
    public static var studySessionSize: String { localized("study.session_size") }

    public static func studyProgress(_ position: Int, _ total: Int) -> String {
        String(format: localized("study.progress"), position, total)
    }

    /// What the result screen's bare fraction counts, spoken for VoiceOver.
    public static func studyResultRemembered(_ remembered: Int, _ planned: Int) -> String {
        String(format: localized("study.result.remembered"), remembered, planned)
    }

    /// The learned share the result ring stands at, spoken for VoiceOver.
    public static func studyResultMasteryLearned(_ percent: Int) -> String {
        String(format: localized("study.result.mastery.learned"), percent)
    }

    /// What the sitting added to the deck, worn by the pill under the ring.
    public static func studyResultMasteryDelta(_ percent: Int) -> String {
        String(format: localized("study.result.mastery.delta"), percent)
    }

    /// The cards leaving the session for the repeat queue, for VoiceOver.
    public static func studyResultReturning(_ count: Int) -> String {
        String(format: localized("study.result.returning"), count)
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
        // The types a subdivision brings with it. Named here so a state's
        // admission date reads as a date somebody joined something rather
        // than as an unlabelled year.
        case "STATEHOOD_DATE": localized("fact.statehood_date")
        case "LARGEST_CITY": localized("fact.largest_city")
        case "MOTTO": localized("fact.motto")
        default: nil
        }
    }

    /// What a symbol's own name is called. Not a fact type: it belongs to the
    /// drawing rather than to the place, which is why it lives on the asset.
    public static var factEmblem: String { localized("fact.emblem") }

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
    public static var syncSignInRequired: String { localized("sync.sign_in_required") }
    public static var syncSignInRequiredChip: String { localized("sync.sign_in_required.chip") }
    public static var homeSignInExpiredTitle: String { localized("home.sign_in_expired.title") }
    /// Declined by the count — "1 ответ ждёт", "2 ответа ждут", "12 ответов
    /// ждут" — so it goes through the catalogue's plural machinery.
    public static func homeSignInExpiredPending(_ count: Int) -> String {
        String.localizedStringWithFormat(
            NSLocalizedString("home.sign_in_expired.pending", bundle: bundle, comment: ""),
            count
        )
    }
    public static var homeGuestPromptTitle: String { localized("home.guest_prompt.title") }
    /// Declined by the count, as `accountGuestNoteCount` is.
    public static func homeGuestPromptCount(_ count: Int) -> String {
        String.localizedStringWithFormat(
            NSLocalizedString("home.guest_prompt.count", bundle: bundle, comment: ""),
            count
        )
    }

    public static func syncPendingChip(_ count: Int) -> String {
        String(format: localized("sync.pending.chip"), count)
    }
    public static var syncSynced: String { localized("sync.synced") }
    public static func syncPending(_ count: Int) -> String {
        String(format: localized("sync.pending"), count)
    }

    /// The header has room for two words, not a sentence. The sentence is
    /// still what the chip says to VoiceOver.
    public static var syncOfflineShort: String { localized("sync.offline_short") }

    /// A guest's work is saved and simply not sent yet. Saying it failed would
    /// be false and would invite them to retry something that is not broken.
    ///
    /// It does name the way out, though. "Saved on this device" is a true
    /// sentence that leaves the reader with nothing to do about it, and a
    /// person who has answered two hundred cards deserves to know what carries
    /// them over: signing in, and nothing else.
    public static func syncSavedOnDevice(_ count: Int) -> String {
        // The plural rule lives in the catalog; only `localizedStringWithFormat`
        // applies it.
        String.localizedStringWithFormat(
            NSLocalizedString("sync.saved_on_device", bundle: bundle, comment: ""),
            count
        )
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

    // MARK: - Commerce
    //
    // Every word the paywall says lives here rather than in a view: the
    // purchase promise ships in Russian and English together, and legal reads
    // it in one file rather than across five screens.

    public static var catalogFeaturedSection: String { localized("catalog.section.featured") }
    public static var catalogFreeSection: String { localized("catalog.section.free") }

    public static var commercePaidBadge: String { localized("commerce.badge.paid") }
    public static var commercePendingBadge: String { localized("commerce.badge.pending") }
    /// What VoiceOver hears where the badge is only a word beside a symbol.
    public static var commercePaidBadgeAccessibility: String {
        localized("commerce.badge.paid.accessibility")
    }

    /// "One-time purchase · 249 ₽", where the price is the store's own string
    /// and never one this app assembled.
    public static func commerceOneTimePrice(_ displayPrice: String) -> String {
        String(format: localized("commerce.price.one_time"), displayPrice)
    }
    public static var commercePriceLoading: String { localized("commerce.price.loading") }
    public static var commercePriceUnavailable: String {
        localized("commerce.price.unavailable")
    }
    public static var commerceExploreDeck: String { localized("commerce.cta.explore") }

    public static var commerceOneTimeTitle: String {
        localized("commerce.paywall.one_time_title")
    }
    public static var commerceAccessForever: String { localized("commerce.paywall.forever") }
    public static var commerceBelongsToAccount: String {
        localized("commerce.paywall.account")
    }
    public static var commerceOtherDevice: String {
        localized("commerce.paywall.other_device")
    }

    public static func commerceBuy(_ displayPrice: String) -> String {
        String(format: localized("commerce.action.buy"), displayPrice)
    }
    public static var commerceSignInToBuy: String { localized("commerce.action.sign_in") }
    public static var commerceAwaitingConfirmation: String {
        localized("commerce.action.pending")
    }
    public static var commerceOpeningDeck: String { localized("commerce.action.delivering") }
    public static var commerceRestore: String { localized("commerce.action.restore") }
    public static var commerceRetry: String { localized("commerce.action.retry") }
    public static var commerceFinishSession: String {
        localized("commerce.action.finish_session")
    }
    public static var commerceRestoredNothing: String { localized("commerce.restore.none") }
    public static var commerceRestored: String { localized("commerce.restore.done") }

    static func commerceStatusTitle(_ state: CommerceStatus) -> String {
        localized("commerce.status.\(state.rawValue).title")
    }
    static func commerceStatusBody(_ state: CommerceStatus) -> String {
        localized("commerce.status.\(state.rawValue).body")
    }
    /// The number a person reads out to support. Never a transaction
    /// identifier: that is personal data, and it is not something to say aloud.
    public static func commerceSupportID(_ supportID: String) -> String {
        String(format: localized("commerce.support_id"), supportID)
    }

    /// What a deck teaches, from the kinds the release published.
    public static func contentKind(_ rawValue: String) -> String? {
        switch rawValue {
        case "FLAG": localized("content.kind.flag")
        case "COAT_OF_ARMS": localized("content.kind.coat_of_arms")
        // A kind published after this release has no word here. It is left
        // out of the summary rather than shown as a code.
        default: nil
        }
    }

    public static var deckAllCards: String { localized("deck.owned.all_cards") }
    public static func deckLearnedOf(_ learned: Int, _ total: Int) -> String {
        String(format: localized("deck.owned.learned"), learned, total)
    }
    public static var deckCardSearchPrompt: String { localized("deck.owned.search") }
    public static var deckStartLearning: String { localized("deck.owned.start") }

    /// The resource bundle of the package. Tests use it to verify that the
    /// string catalog is actually compiled instead of falling back to keys.
    static var bundle: Bundle { .module }

    static func localized(_ key: String) -> String {
        String(localized: String.LocalizationValue(key), bundle: bundle)
    }
}
