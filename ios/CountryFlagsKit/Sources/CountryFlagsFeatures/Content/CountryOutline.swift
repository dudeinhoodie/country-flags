import CoreLocation
import SwiftUI

import CountryFlagsDomain

/// Finds a country's outline the way the flag itself is found: by the
/// asset's checksum, through the bundled index, to the slug — which is what
/// makes the match survive a display name in any language. Both the card's
/// back and the details sheet resolve through here, so they cannot drift.
enum CountryOutlineLookup {
    /// The editorial deck of places that belong to no continent. Its members
    /// — Antarctica, Bouvet, the remote islets — are exactly where the
    /// boundary source is least trustworthy, so their maps draw no trace at
    /// all: membership is the editor's word, not a hard-coded list. The code
    /// is the backend's derivation of the editorial key `deck.special-areas`
    /// — `deckCodeFromKey` in `bundle-mapper.ts`, the same rule that turns
    /// `deck.all` into the `ALL` the progress screen matches on.
    private static let specialAreasDeckCode = "SPECIAL_AREAS"

    static func outline(
        forPromptAsset assetID: UUID, cardID: UUID, store: ContentStore
    ) async -> CountryBoundaries.Outline? {
        guard
            let record = await store.asset(id: assetID),
            let assetName = BundledFlags.shipped.assetName(forChecksum: record.sha256)
        else { return nil }
        let slug = String(assetName.dropFirst("flag-".count))
        guard let outline = CountryBoundaries.shipped.outline(forSlug: slug) else {
            return nil
        }
        if await belongsToSpecialAreas(cardID: cardID, store: store) {
            return outline.untraced()
        }
        return outline
    }

    private static func belongsToSpecialAreas(
        cardID: UUID, store: ContentStore
    ) async -> Bool {
        guard
            let special = await store.decks()
                .first(where: { $0.code == specialAreasDeckCode })
        else { return false }
        return (await store.cardIdentifiersByDeck()[special.id] ?? []).contains(cardID)
    }
}

/// Resolves the alternate, "official" name of the country behind a card —
/// nil when the entity is unknown or its official name is only the display
/// name again. The card's back and the details sheet both resolve through
/// here, so they cannot drift on which name counts as official.
enum CountryOfficialNameLookup {
    static func officialName(
        forEntity entityID: UUID?, displayName: String, store: ContentStore
    ) async -> String? {
        guard
            let entityID,
            let entity = await store.entity(id: entityID),
            let official = entity.names.first(where: { !$0.isPrimary })?.value,
            official != displayName
        else { return nil }
        return official
    }
}

/// A country's landmass as a quiet filled shape — the watermark form of the
/// outline the map draws, projected the same way the continent silhouettes
/// are: longitude scaled by the middle latitude so the shape keeps its
/// proportions off the globe.
struct CountrySilhouetteView: View {
    let outline: CountryBoundaries.Outline
    var opacity: Double = 0.07

    var body: some View {
        Canvas { context, size in
            var minimumLatitude = Double.greatestFiniteMagnitude
            var maximumLatitude = -Double.greatestFiniteMagnitude
            var minimumLongitude = Double.greatestFiniteMagnitude
            var maximumLongitude = -Double.greatestFiniteMagnitude
            for ring in outline.fills {
                for point in ring {
                    minimumLatitude = min(minimumLatitude, point.latitude)
                    maximumLatitude = max(maximumLatitude, point.latitude)
                    minimumLongitude = min(minimumLongitude, point.longitude)
                    maximumLongitude = max(maximumLongitude, point.longitude)
                }
            }
            let stretch = cos((minimumLatitude + maximumLatitude) / 2 * .pi / 180)
            let width = (maximumLongitude - minimumLongitude) * stretch
            let height = maximumLatitude - minimumLatitude
            guard width > 0, height > 0 else { return }

            let scale = min(size.width / width, size.height / height)
            let offsetX = (size.width - width * scale) / 2
            let offsetY = (size.height - height * scale) / 2

            var path = Path()
            for ring in outline.fills {
                guard let first = ring.first else { continue }
                path.move(
                    to: CGPoint(
                        x: offsetX + (first.longitude - minimumLongitude) * stretch * scale,
                        y: offsetY + (maximumLatitude - first.latitude) * scale
                    )
                )
                for point in ring.dropFirst() {
                    path.addLine(
                        to: CGPoint(
                            x: offsetX + (point.longitude - minimumLongitude) * stretch * scale,
                            y: offsetY + (maximumLatitude - point.latitude) * scale
                        )
                    )
                }
                path.closeSubpath()
            }
            context.fill(path, with: .color(.white.opacity(opacity)))
        }
        .accessibilityHidden(true)
        .allowsHitTesting(false)
    }
}
