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
    /// What the sheet is about. It decides the heading over the facts and
    /// whether there is a country above this place — read from the entity,
    /// never from the deck that opened the sheet.
    @State private var subjectKind = CardSubjectKind.unresolved
    @State private var parent: GeoEntityParentRecord?
    /// The prompt's own name and story, when the release publishes them. They
    /// belong to the drawing rather than to the place: an entity has several
    /// drawings now, and each has its own history.
    @State private var symbolName: String?
    @State private var symbolStory: String?
    @State private var symbolIsCoatOfArms = false
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

                // What the symbol means, when the release says. Above the
                // facts because it is what the card just asked about: the
                // reader opened this sheet from a drawing, not from a place.
                if symbolStory != nil || symbolName != nil {
                    symbolPane
                }

                // The heading names what kind of place this is. `Country
                // facts` over a state's capital and admission date would be
                // wrong about the state and about the country above it.
                Text(
                    subjectKind == .subdivision
                        ? L10n.detailsStateFacts : L10n.detailsCountryFacts
                )
                .font(DesignTokens.Typography.sectionTitle)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier(AccessibilityIdentifier.detailsFacts)

                // Every entry is a tile, dealt in pairs. Each pair is fixed
                // vertically so it takes the taller tile's height: left to
                // themselves the tiles sized to their own text, and a wrapped
                // population left the row ragged.
                ForEach(Array(stride(from: 0, to: entries.count, by: 2)), id: \.self) { start in
                    HStack(alignment: .top, spacing: DesignTokens.Spacing.small) {
                        tile(entries[start])
                        if start + 1 < entries.count {
                            tile(entries[start + 1])
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
            if let entityID = record?.subjectEntityID,
                let entity = await store.entity(id: entityID)
            {
                subjectKind = CardSubjectKind(entityKind: entity.entityKind)
                parent = entity.parent
            }
            if let asset = await store.asset(id: subject.promptAssetID) {
                symbolIsCoatOfArms = asset.assetType == .coatOfArms
                // A name identical to the place is not a name of its own, and
                // "Germany — Germany" is a row that says nothing.
                let name = asset.displayName
                symbolName = (name?.isEmpty == false && name != subject.displayName) ? name : nil
                symbolStory = asset.assetDescription?.isEmpty == false
                    ? asset.assetDescription : nil
            }
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

    /// The parent first, then the facts in the release's own order. The
    /// country a state belongs to is the thing that places it, so it is not
    /// dealt somewhere in the middle of the grid.
    private var entries: [DetailEntry] {
        var entries: [DetailEntry] = []
        if subjectKind == .subdivision, let parent {
            entries.append(DetailEntry(parent: parent))
        }
        entries.append(contentsOf: facts.map(DetailEntry.init(fact:)))
        return entries
    }

    private func tile(_ entry: DetailEntry) -> some View {
        DetailTile(
            symbol: entry.symbol,
            color: entry.color,
            label: entry.label,
            value: entry.value
        )
        .accessibilityIdentifier(
            entry.factType.map(AccessibilityIdentifier.studyFact)
                ?? AccessibilityIdentifier.detailsParent
        )
    }

    /// The story of the drawing: what it is called, and what it means.
    ///
    /// One pane rather than two tiles because a story is prose — it wraps, it
    /// grows with the reader's text size, and a fixed tile would clip it.
    private var symbolPane: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
            Text(
                symbolIsCoatOfArms ? L10n.detailsSymbolStory : L10n.detailsSymbolStoryFlag
            )
            .font(DesignTokens.Typography.sectionTitle)
            .accessibilityAddTraits(.isHeader)

            if let symbolName {
                HStack(spacing: DesignTokens.Spacing.small) {
                    SymbolBadge(
                        symbol: symbolIsCoatOfArms ? "shield.fill" : "flag.fill",
                        color: .purple
                    )
                    VStack(alignment: .leading, spacing: 0) {
                        // "Name", not "Emblem": the pane's own heading has
                        // already said which drawing this is, and a flag's
                        // name is not an emblem's.
                        Text(L10n.detailsSymbolName)
                            .font(DesignTokens.Typography.caption)
                            .foregroundStyle(.secondary)
                        Text(symbolName)
                            .font(DesignTokens.Typography.body.weight(.medium))
                    }
                }
                .accessibilityElement(children: .combine)
            }

            if let symbolStory {
                Text(symbolStory)
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(DesignTokens.Spacing.medium)
        .glassEffect(
            .regular,
            in: RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous)
        )
        .accessibilityIdentifier(AccessibilityIdentifier.detailsSymbolStory)
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
        SymbolBadge(symbol: Self.symbol(for: fact.type), color: Self.color(for: fact.type))
    }

    static func symbol(for type: String) -> String {
        switch type.uppercased() {
        case "CAPITAL": "mappin.and.ellipse"
        case "POPULATION": "person.2.fill"
        case "CURRENCY": "banknote.fill"
        case "LANGUAGE": "character.bubble.fill"
        case "AREA": "square.dashed"
        case "STATEHOOD_DATE": "calendar"
        case "LARGEST_CITY": "building.2.fill"
        case "MOTTO": "quote.opening"
        default: "info.circle"
        }
    }

    static func color(for type: String) -> Color {
        switch type.uppercased() {
        case "CAPITAL": .purple
        case "POPULATION": .blue
        case "CURRENCY": .green
        case "LANGUAGE": .orange
        case "AREA": .teal
        case "STATEHOOD_DATE": .indigo
        case "LARGEST_CITY": .pink
        case "MOTTO": .brown
        default: .gray
        }
    }
}

/// The badge itself, for the rows a fact type does not name — the emblem's
/// own title among a country's facts is one of them.
struct SymbolBadge: View {
    let symbol: String
    let color: Color

    var body: some View {
        Image(systemName: symbol)
            .font(DesignTokens.Typography.caption.weight(.semibold))
            .foregroundStyle(.white)
            .frame(width: DesignTokens.Spacing.extraLarge, height: DesignTokens.Spacing.extraLarge)
            .background(color.gradient, in: Circle())
            .accessibilityHidden(true)
    }
}

/// One entry, large enough to be the reason the sheet was opened.
private struct DetailTile: View {
    let symbol: String
    let color: Color
    let label: String?
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
            SymbolBadge(symbol: symbol, color: color)

            VStack(alignment: .leading, spacing: 0) {
                if let label {
                    Text(label)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.secondary)
                }
                Text(value)
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
        // One tile is one thing to hear, not a label and a value in sequence.
        .accessibilityElement(children: .combine)
    }
}

/// One entry of the sheet's grid.
///
/// A fact is the usual case. The parent country of a state is the other one:
/// it is not a fact the release publishes about the state, it is the state's
/// place in the world, and a reader looking at California's flag needs it
/// first — which is why it is dealt as a tile and not left in a caption.
private struct DetailEntry: Identifiable {
    let id: String
    let symbol: String
    let color: Color
    let label: String?
    let value: String
    /// Set for a fact, so the tile can carry the identifier a UI test asks
    /// for by type.
    let factType: String?

    init(fact: FactRecord) {
        let presentation = FactDisplay.presentation(for: fact)
        id = "fact.\(fact.type).\(presentation.value)"
        symbol = FactBadge.symbol(for: fact.type)
        color = FactBadge.color(for: fact.type)
        label = presentation.label
        value = presentation.value
        factType = fact.type
    }

    init(parent: GeoEntityParentRecord) {
        id = "parent.\(parent.id.uuidString)"
        symbol = "globe"
        color = .indigo
        label = L10n.detailsParentCountry
        value = parent.name
        factType = nil
    }
}
