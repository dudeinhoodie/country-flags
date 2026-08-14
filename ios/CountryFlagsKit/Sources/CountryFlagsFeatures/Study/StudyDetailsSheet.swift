import SwiftUI

import CountryFlagsDomain

/// Everything the release says about the country, on a surface that can grow.
///
/// It exists because the back of a card cannot: that side is bounded by the
/// flag's proportion, and an official name at an accessibility text size does
/// not fit on it. A sheet scrolls, takes a detent the reader chooses and is
/// dismissed by the gesture everybody already knows.
///
/// The layout is the platform's own object sheet — the one Find My opens for
/// a device: the name large and flush left, the way out a small circle beside
/// it, and the substance below as glass panes. The two facts a learner reaches
/// for first sit as tiles; the rest are rows in one pane. Every fact carries a
/// symbol on its own colour, because a list where only the words differ is a
/// list nobody can scan.
struct StudyDetailsSheet: View {
    let card: StudySessionCardRecord
    let store: ContentStore
    let assets: any AssetLoading

    @State private var facts: [FactRecord] = []
    @State private var outline: CountryBoundaries.Outline?
    @State private var isShowingFullMap = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.medium) {
                header

                flag

                // Every fact is a tile, dealt in pairs. Each pair is fixed
                // vertically so it takes the taller tile's height: left to
                // themselves the tiles sized to their own text, and a wrapped
                // population left the row ragged.
                ForEach(Array(stride(from: 0, to: facts.count, by: 2)), id: \.self) { start in
                    HStack(alignment: .top, spacing: DesignTokens.Spacing.small) {
                        FactTile(fact: facts[start])
                        if start + 1 < facts.count {
                            FactTile(fact: facts[start + 1])
                        }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }

                // Where the country is. Missing for the flags whose landmass
                // the 1:110m source does not carry — a microstate's sheet
                // simply ends at the facts.
                if let outline {
                    CountryMapView(outline: outline)
                        .frame(height: DesignTokens.Layout.detailMapHeight)
                        .clipShape(
                            RoundedRectangle(
                                cornerRadius: DesignTokens.Radius.large, style: .continuous
                            )
                        )
                        .overlay {
                            RoundedRectangle(
                                cornerRadius: DesignTokens.Radius.large, style: .continuous
                            )
                            .strokeBorder(
                                .white.opacity(DesignTokens.Card.borderOpacity),
                                lineWidth: 1 / displayScale
                            )
                        }
                        // The button lies over the map rather than around it:
                        // MapKit owns its own touch handling underneath, and a
                        // wrapping button's tap never reliably got through.
                        .overlay {
                            Button {
                                isShowingFullMap = true
                            } label: {
                                Color.clear
                                    .contentShape(
                                        RoundedRectangle(
                                            cornerRadius: DesignTokens.Radius.large,
                                            style: .continuous
                                        )
                                    )
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(L10n.studyMapOpen)
                            .accessibilityIdentifier(AccessibilityIdentifier.studyMap)
                        }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(DesignTokens.Spacing.large)
        }
        .scrollIndicators(.hidden)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(.regularMaterial)
        .fullScreenCover(isPresented: $isShowingFullMap) {
            if let outline {
                CountryMapExpandedView(name: card.displayName, outline: outline)
            }
        }
        .task(id: card.learningCardID) {
            facts = await store.card(id: card.learningCardID)?.backSideFacts ?? []
            // The outline is found the way the flag itself is: by the asset's
            // checksum, through the bundled index, to the slug — which is what
            // makes it survive a display name in any language.
            if let record = await store.asset(id: card.promptAssetID),
                let assetName = BundledFlags.shipped.assetName(forChecksum: record.sha256) {
                let slug = String(assetName.dropFirst("flag-".count))
                outline = CountryBoundaries.shipped.outline(forSlug: slug)
            }
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: DesignTokens.Spacing.medium) {
            // The country is content, so it takes the largest role here as it
            // does everywhere else it appears.
            Text(card.displayName)
                .font(DesignTokens.Typography.screenTitle)
                .minimumScaleFactor(0.6)
                .lineLimit(2)
                .accessibilityAddTraits(.isHeader)

            Spacer(minLength: 0)

            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(DesignTokens.Typography.caption.weight(.semibold))
                    .foregroundStyle(.primary)
                    .frame(
                        width: DesignTokens.Layout.minimumTouchTarget * 0.8,
                        height: DesignTokens.Layout.minimumTouchTarget * 0.8
                    )
                    .background(.ultraThinMaterial, in: Circle())
            }
            .accessibilityLabel(L10n.studyClose)
        }
    }

    private var flag: some View {
        FlagImageView(
            assetID: card.promptAssetID,
            accessibilityLabel: card.displayName,
            store: store,
            assets: assets
        )
        .aspectRatio(DesignTokens.Card.aspectRatio, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous)
                .strokeBorder(
                    .white.opacity(DesignTokens.Card.borderOpacity),
                    lineWidth: 1 / displayScale
                )
        }
    }

}

/// The badge every fact wears: its symbol on its own colour.
///
/// The colour is never the only carrier — the symbol and the label are always
/// beside it — it is what lets the eye land on "population" without reading.
private struct FactBadge: View {
    let fact: FactRecord

    var body: some View {
        Image(systemName: symbol)
            .font(DesignTokens.Typography.caption.weight(.semibold))
            .foregroundStyle(.white)
            .frame(width: DesignTokens.Spacing.extraLarge, height: DesignTokens.Spacing.extraLarge)
            .background(color.gradient, in: Circle())
            .accessibilityHidden(true)
    }

    private var symbol: String {
        switch fact.type.uppercased() {
        case "CAPITAL": "mappin.and.ellipse"
        case "POPULATION": "person.2.fill"
        case "CURRENCY": "banknote.fill"
        case "LANGUAGE": "character.bubble.fill"
        case "AREA": "square.dashed"
        default: "info.circle"
        }
    }

    private var color: Color {
        switch fact.type.uppercased() {
        case "CAPITAL": .purple
        case "POPULATION": .blue
        case "CURRENCY": .green
        case "LANGUAGE": .orange
        case "AREA": .teal
        default: .gray
        }
    }
}

/// A fact large enough to be the reason the sheet was opened.
private struct FactTile: View {
    let fact: FactRecord

    @Environment(\.displayScale) private var displayScale

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
            FactBadge(fact: fact)

            VStack(alignment: .leading, spacing: 0) {
                if let label = presentation.label {
                    Text(label)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.secondary)
                }
                Text(presentation.value)
                    .font(DesignTokens.Typography.sectionTitle)
                    .minimumScaleFactor(0.7)
                    .lineLimit(3)
            }
        }
        // Filled to the slot rather than hugging the text, so the pair of
        // tiles reads as a pair and not as two notes of different lengths.
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(DesignTokens.Spacing.medium)
        .background(
            .ultraThinMaterial,
            in: RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous)
                .strokeBorder(
                    .white.opacity(DesignTokens.Card.borderOpacity),
                    lineWidth: 1 / displayScale
                )
        }
        // One fact is one thing to hear, not a label and a value in sequence.
        .accessibilityElement(children: .combine)
    }

    /// The label and the value, with the vintage moved to where it belongs.
    ///
    /// A population arrives as "1,358,282 (2024)": the year is provenance,
    /// not part of the number, and in brackets after it it read as a code.
    /// It moves into the label — "Population 2024" — and the number stands
    /// alone. A value without a trailing year is passed through untouched.
    private var presentation: (label: String?, value: String) {
        let label = L10n.factType(fact.type)
        guard
            let label,
            let match = fact.displayValue.range(
                of: #" \((\d{4})\)$"#, options: .regularExpression
            )
        else {
            return (label, fact.displayValue)
        }
        let year = fact.displayValue[match].dropFirst(2).dropLast(1)
        return ("\(label) \(year)", String(fact.displayValue[..<match.lowerBound]))
    }
}
