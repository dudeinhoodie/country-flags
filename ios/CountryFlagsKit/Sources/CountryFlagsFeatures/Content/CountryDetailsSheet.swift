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
/// The country a details sheet is about: enough to find its name, its flag
/// and its facts, from either side of the app that opens one — a card mid-
/// session or a flag on the progress shelves. One subject, one sheet: a
/// change here changes every place that presents it.
struct CountryDetailsSubject: Hashable, Identifiable {
    /// The learning card the release hangs the country's facts on.
    let cardID: UUID
    let displayName: String
    let promptAssetID: UUID

    var id: UUID { cardID }

    init(card: StudySessionCardRecord) {
        cardID = card.learningCardID
        displayName = card.displayName
        promptAssetID = card.promptAssetID
    }

    init(card: LearningCardRecord) {
        cardID = card.id
        displayName = card.displayName
        promptAssetID = card.promptAssetID
    }
}

struct CountryDetailsSheet: View {
    let subject: CountryDetailsSubject
    let store: ContentStore
    let assets: any AssetLoading
    @State private var facts: [FactRecord] = []
    @State private var regionDeck: DeckRecord?
    @State private var officialName: String?
    @State private var outline: CountryBoundaries.Outline?
    /// Whether the outline lookup has answered. Until it has, the pair row
    /// keeps the map's slot as a placeholder: laying the flag out full-width
    /// and then shrinking it when the map arrived read as a glitch.
    @State private var didResolveOutline = false
    @State private var isShowingFullMap = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.medium) {
                header

                // The flag and its shelf, one row: the flag keeps a fixed
                // plate — an aspect-ratio view offered the whole width takes
                // it, and the region vanished into a sliver — and the region
                // tile takes the rest.
                HStack(spacing: DesignTokens.Spacing.small) {
                    flag
                        .frame(
                            width: regionDeck == nil
                                ? nil : DesignTokens.Layout.detailPairFlagWidth
                        )

                    if let regionDeck {
                        regionTile(regionDeck)
                    }
                }
                .frame(height: DesignTokens.Layout.detailPairHeight)

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


                // The map closes the sheet, full width and generous: the
                // drawer ends on where the country is. Its seat is held while
                // the lookup answers, so nothing below the fold jumps.
                if let outline {
                    mapTile(outline)
                        .frame(height: DesignTokens.Layout.detailMapHeight)
                } else if !didResolveOutline {
                    SkeletonBlock(
                        height: DesignTokens.Layout.detailMapHeight,
                        radius: DesignTokens.Radius.large
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(DesignTokens.Spacing.large)
        }
        .scrollIndicators(.hidden)
        // The sheet's content usually fits the screen whole, and a fitting
        // scroll view still rubber-bands — a bounce that read as a pull-to-
        // refresh and swallowed the closing pull. Without it, the drag goes
        // to the sheet the moment there is nothing left to scroll.
        .scrollBounceBehavior(.basedOnSize)
        // Full height at once: the sheet holds a flag, four facts and a map,
        // and a half-open sheet showed the flag the reader had already seen.
        .presentationDetents([.large])
        // A pull at the top closes the sheet instead of rubber-banding the
        // scroll: the bounce read as a pull-to-refresh that never came, on a
        // sheet with nothing to refresh. Mid-scroll dragging is untouched.
        .presentationContentInteraction(.resizes)
        // No grabber: the pull works from anywhere on the sheet now, and the
        // close circle is in the header — the pellet was chrome with no job.
        .presentationDragIndicator(.hidden)
        .presentationBackground(.regularMaterial)
        .fullScreenCover(isPresented: $isShowingFullMap) {
            if let outline {
                CountryMapExpandedView(name: subject.displayName, outline: outline)
            }
        }
        .task(id: subject.cardID) {
            let record = await store.card(id: subject.cardID)
            facts = record?.backSideFacts ?? []
            officialName = await CountryOfficialNameLookup.officialName(
                forEntity: record?.subjectEntityID,
                displayName: subject.displayName,
                store: store
            )
            let decks = await store.decks()
            let membership = await store.cardIdentifiersByDeck()
            regionDeck = decks.first { deck in
                DeckKind(rawValue: deck.kind) == .taxonomy
                    && (membership[deck.id] ?? []).contains(subject.cardID)
            }
            outline = await CountryOutlineLookup.outline(
                forPromptAsset: subject.promptAssetID, cardID: subject.cardID, store: store
            )
            didResolveOutline = true
        }
    }

    private func regionTile(_ deck: DeckRecord) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
            ContinentSilhouetteView(code: deck.code, opacity: 0.8)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            VStack(alignment: .leading, spacing: 0) {
                Text(L10n.detailsRegion)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.secondary)
                Text(deck.name)
                    .font(DesignTokens.Typography.sectionTitle)
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(DesignTokens.Spacing.medium)
        .glassEffect(
            .regular,
            in: RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }

    /// The real globe, tile-sized: the same MapKit view, the same tap into
    /// the full-screen interactive map.
    private func mapTile(_ outline: CountryBoundaries.Outline) -> some View {
        CountryMapView(outline: outline)
            .clipShape(
                RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous)
                    .strokeBorder(
                        .white.opacity(DesignTokens.Card.borderOpacity),
                        lineWidth: 1 / displayScale
                    )
            }
            // The button lies over the map rather than around it: MapKit owns
            // its own touch handling underneath, and a wrapping button's tap
            // never reliably got through.
            .overlay {
                Button {
                    isShowingFullMap = true
                } label: {
                    Color.clear
                        .contentShape(
                            RoundedRectangle(
                                cornerRadius: DesignTokens.Radius.large, style: .continuous
                            )
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L10n.studyMapOpen)
                .accessibilityIdentifier(AccessibilityIdentifier.studyMap)
            }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: DesignTokens.Spacing.medium) {
            // The country is content, so it takes the largest role here as it
            // does everywhere else it appears.
            VStack(alignment: .leading, spacing: 0) {
                Text(subject.displayName)
                    .font(DesignTokens.Typography.screenTitle)
                    .minimumScaleFactor(0.6)
                    .lineLimit(2)
                    .accessibilityAddTraits(.isHeader)

                if let officialName {
                    Text(officialName)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }

            Spacer(minLength: 0)

            // The system's own liquid glass, not a material pretending to
            // be it — this is what the iOS 26 floor was raised for. Primary
            // over glass rather than the accent tint: the way out is chrome,
            // not content.
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(DesignTokens.Typography.caption.weight(.semibold))
                    .foregroundStyle(.primary)
                    // The glass style pads the label to a comfortable
                    // target on its own; sizing the symbol's box like a
                    // standalone button doubled that up into a saucer.
                    .frame(
                        width: DesignTokens.Layout.minimumTouchTarget * 0.45,
                        height: DesignTokens.Layout.minimumTouchTarget * 0.45
                    )
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .accessibilityLabel(L10n.studyClose)
        }
    }

    private var flag: some View {
        FlagImageView(
            assetID: subject.promptAssetID,
            accessibilityLabel: subject.displayName,
            store: store,
            assets: assets
        )
        .aspectRatio(DesignTokens.Card.aspectRatio, contentMode: .fit)
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
struct FactBadge: View {
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
        .glassEffect(
            .regular,
            in: RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous)
        )
        // One fact is one thing to hear, not a label and a value in sequence.
        .accessibilityElement(children: .combine)
    }

    private var presentation: (label: String?, value: String) {
        FactDisplay.presentation(for: fact)
    }
}
