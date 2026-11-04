import SwiftUI

import CountryFlagsDomain

/// What the release says about the country, shown once the answer is out.
///
/// The facts are read from the store rather than carried in the session
/// snapshot: the snapshot exists so the card that was answered stays the card
/// that was shown, and that is about the answer. A capital is supporting
/// detail, read from the release the device currently holds.
///
/// A card the release publishes no facts for shows nothing at all — an empty
/// section would be a promise the content did not keep.
struct CardBackFactsView: View {
    let learningCardID: UUID
    /// The prompt the question was asked with, and the template that asked
    /// it. Together they decide one row: a coat of arms has a name of its own,
    /// and the answer owes it to a learner who has just been shown one.
    var promptAssetID: UUID?
    var face: CardFace = .pending
    /// What the card is about, so a symbol named after it is not repeated.
    var subject: String = ""
    let store: ContentStore

    @State private var facts: [FactRecord] = []
    @State private var symbolName: String?

    var body: some View {
        // The rows hang off a container that is always in the hierarchy: a
        // view that renders nothing until its own data arrives never gets the
        // task that would fetch it.
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
            if let symbolName {
                FactRow(symbol: "shield.fill", color: .purple, label: L10n.factEmblem, value: symbolName)
                    .accessibilityIdentifier(AccessibilityIdentifier.studySymbolName)
            }
            ForEach(facts, id: \.self) { fact in
                FactRow(fact: fact)
                    .accessibilityIdentifier(AccessibilityIdentifier.studyFact(fact.type))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: learningCardID) {
            facts = await store.card(id: learningCardID)?.backSideFacts ?? []
            guard let promptAssetID else { return }
            symbolName = await SymbolNameLookup.name(
                forPromptAsset: promptAssetID,
                face: face,
                subject: subject,
                store: store
            )
        }
    }
}
