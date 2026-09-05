import Foundation

import CountryFlagsDomain

/// Says that this build met a card it has no renderer for.
///
/// It goes out as an operational error rather than as a product event, which
/// is the distinction the privacy model is built on: a template nobody can
/// draw is the app failing to show content somebody paid for, and the people
/// who have to fix it need to see it whether or not analytics was allowed.
/// Nothing in the report but the template's own code and version — both
/// constants the pipeline publishes.
///
/// `docs/18-multi-content-paid-decks.md` §12 names the same fact
/// `content.unsupported_card_template`; the registry of product events is
/// shared with the backend and adding a name to it is a contract change, so
/// until that lands this reports through the channel that needs no registry.
enum UnsupportedCardTemplateReport {
    /// The operation the report is filed under, so a search finds every one of
    /// them however the card was met.
    static let operation = "unsupported_card_template"

    /// Reports each unknown `templateCode + templateSchemaVersion` among these
    /// cards once.
    ///
    /// Called where a session is composed: that is the moment the cards are in
    /// hand and the moment they are dropped, so what is reported is exactly
    /// what the learner did not get.
    static func send(for cards: [LearningCardRecord], to errors: (any ErrorReporting)?) {
        guard let errors else { return }
        for key in CardTemplateRegistry.unsupportedKeys(in: cards) {
            send(key, to: errors)
        }
    }

    /// The other way one is met: a card already inside a session this build
    /// did not compose — resumed from an older release, or selected by the
    /// backend — that reaches the screen and finds no face to wear.
    static func send(_ key: CardTemplateKey, to errors: (any ErrorReporting)?) {
        errors?.capture(
            error: UnsupportedCardTemplate(key: key),
            context: ErrorContext(
                category: .content,
                operation: operation,
                errorCode: key.identifier
            )
        )
    }
}
