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
    let store: ContentStore

    @State private var facts: [FactRecord] = []

    var body: some View {
        // The rows hang off a container that is always in the hierarchy: a
        // view that renders nothing until its own data arrives never gets the
        // task that would fetch it.
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
            ForEach(facts, id: \.self) { fact in
                CardBackFactRow(fact: fact)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: learningCardID) {
            facts = await store.card(id: learningCardID)?.backSideFacts ?? []
        }
    }
}

private struct CardBackFactRow: View {
    let fact: FactRecord

    var body: some View {
        // Through the same wording as the other two surfaces. Read straight
        // from the record, this row showed the currency's ISO code while the
        // self-rated card next door did not — the drift `FactDisplay` exists
        // to prevent, on the one screen that was not using it.
        let presentation = FactDisplay.presentation(for: fact)
        HStack(alignment: .firstTextBaseline, spacing: DesignTokens.Spacing.small) {
            if let name = presentation.label {
                Text(name)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.secondary)
                    .frame(width: 96, alignment: .leading)
            }
            Text(presentation.value)
                .font(DesignTokens.Typography.body)
            Spacer(minLength: 0)
        }
        // One fact is one thing to hear, not a label and a value in sequence.
        .accessibilityElement(children: .combine)
        // The identifier sits on the row rather than on the stack around it:
        // an identifier on a SwiftUI container is handed to its descendants
        // and makes them indistinguishable in a query.
        .accessibilityIdentifier(AccessibilityIdentifier.studyFact(fact.type))
    }
}
