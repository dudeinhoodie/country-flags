import SwiftUI

import CountryFlagsDomain

/// Everything the release says about the country, on a surface that can grow.
///
/// It exists because the back of a card cannot: that side is bounded by the
/// flag's proportion, and an official name at an accessibility text size does
/// not fit on it. A sheet scrolls, takes a detent the reader chooses and is
/// dismissed by the gesture everybody already knows.
///
/// The flag comes with it. Opened from the back of a card, the sheet would
/// otherwise be the only place in the session where the country is a name
/// without a picture.
struct StudyDetailsSheet: View {
    let card: StudySessionCardRecord
    let store: ContentStore
    let assets: any AssetLoading

    @State private var facts: [FactRecord] = []
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.large) {
                header
                if !facts.isEmpty {
                    factsSection
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(DesignTokens.Spacing.large)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(.regularMaterial)
        .task(id: card.learningCardID) {
            facts = await store.card(id: card.learningCardID)?.backSideFacts ?? []
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: DesignTokens.Spacing.medium) {
            FlagImageView(
                assetID: card.promptAssetID,
                accessibilityLabel: card.displayName,
                store: store,
                assets: assets
            )
            .frame(width: DesignTokens.Layout.thumbFlagWidth)
            .clipShape(
                RoundedRectangle(cornerRadius: DesignTokens.Radius.small, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: DesignTokens.Radius.small, style: .continuous)
                    .strokeBorder(
                        Color.primary.opacity(DesignTokens.Card.borderOpacity),
                        lineWidth: 1 / displayScale
                    )
            }

            // The country is content, so it takes the largest role here as it
            // does everywhere else it appears.
            Text(card.displayName)
                .font(DesignTokens.Typography.screenTitle)
                .minimumScaleFactor(0.7)
                .lineLimit(3)
                .accessibilityAddTraits(.isHeader)

            Spacer(minLength: 0)
        }
    }

    private var factsSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
            Text(L10n.studyDetailsTitle)
                .font(DesignTokens.Typography.caption)
                .textCase(.uppercase)
                .foregroundStyle(.secondary)

            VStack(spacing: 0) {
                ForEach(Array(facts.enumerated()), id: \.element) { index, fact in
                    if index > 0 {
                        Divider().padding(.leading, DesignTokens.Spacing.extraLarge)
                    }
                    row(fact)
                }
            }
            .background(.background.secondary)
            .clipShape(
                RoundedRectangle(cornerRadius: DesignTokens.Radius.medium, style: .continuous)
            )
        }
    }

    private func row(_ fact: FactRecord) -> some View {
        HStack(spacing: DesignTokens.Spacing.medium) {
            Image(systemName: symbol(for: fact.type))
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(.secondary)
                .frame(width: DesignTokens.Spacing.large)

            // A type this build has no name for is shown as its value alone
            // rather than dropped or labelled with its code.
            if let name = L10n.factType(fact.type) {
                Text(name)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: DesignTokens.Spacing.small)

            Text(fact.displayValue)
                .fontWeight(.medium)
                .multilineTextAlignment(.trailing)
        }
        .font(DesignTokens.Typography.body)
        .padding(DesignTokens.Spacing.medium)
        .accessibilityElement(children: .combine)
    }

    /// Shape as well as word, for the same reason the rating buttons carry one.
    private func symbol(for type: String) -> String {
        switch type.uppercased() {
        case "CAPITAL": "mappin.and.ellipse"
        case "POPULATION": "person.2"
        case "CURRENCY": "banknote"
        case "LANGUAGE": "character.bubble"
        case "AREA": "square.dashed"
        default: "info.circle"
        }
    }
}
