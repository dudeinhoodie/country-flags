import SwiftUI

import CountryFlagsDomain

/// The face of a card whose subject is a flag.
///
/// Flags are not all the card's shape — Switzerland is square, Sweden and
/// Brazil are neither — so a card of one proportion leaves bars beside them.
/// The bars are filled with the flag itself, out of focus and drawn larger
/// than the card so the blur's soft edges fall outside the clip: the card
/// reads as full, and the flag on top is still whole. Cropping the flag to
/// fit would make it a different flag, which the spec forbids in as many
/// words.
///
/// Both sessions draw their flag through this, which is what keeps a deck
/// card and a quiz card the same object in two places.
struct FlagCardFace: View {
    let assetID: UUID
    /// What VoiceOver calls the card. Before the answer is out this must not
    /// name the country, or the reader would answer the question for the
    /// learner.
    let accessibilityLabel: String
    var accessibilityHint: String = ""
    let store: ContentStore
    let assets: any AssetLoading

    var body: some View {
        // Full bleed, under a lens: the flag is the card edge to edge, and a
        // light top rim with a shaded lower one says glass over print rather
        // than a picture pasted on. The card's own hairline still gives a
        // mostly white flag its edge against the scene.
        FlagImageView(
            assetID: assetID,
            accessibilityLabel: accessibilityLabel,
            store: store,
            assets: assets
        )
        .accessibilityHint(accessibilityHint)
        .overlay {
            LinearGradient(
                colors: [
                    .white.opacity(DesignTokens.Card.lensSheenOpacity),
                    .clear,
                    .black.opacity(DesignTokens.Card.lensShadeOpacity),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .allowsHitTesting(false)
        }
        .overlay(alignment: .top) {
            Color.white.opacity(0.3).frame(height: 1).allowsHitTesting(false)
        }
        .overlay(alignment: .bottom) {
            Color.black.opacity(0.25).frame(height: 1).allowsHitTesting(false)
        }
    }
}
