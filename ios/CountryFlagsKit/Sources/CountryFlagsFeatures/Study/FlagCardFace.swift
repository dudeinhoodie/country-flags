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
        ZStack {
            FlagImageView(
                assetID: assetID,
                accessibilityLabel: "",
                store: store,
                assets: assets,
                contentMode: .fill
            )
            .blur(radius: DesignTokens.Card.groundBlur)
            .scaleEffect(DesignTokens.Card.groundOverscan)
            .opacity(DesignTokens.Card.groundOpacity)
            .accessibilityHidden(true)

            FlagImageView(
                assetID: assetID,
                accessibilityLabel: accessibilityLabel,
                store: store,
                assets: assets
            )
            .accessibilityHint(accessibilityHint)
        }
    }
}
