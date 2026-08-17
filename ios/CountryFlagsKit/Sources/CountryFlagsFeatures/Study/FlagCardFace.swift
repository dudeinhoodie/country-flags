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

    @Environment(\.displayScale) private var displayScale

    var body: some View {
        // A mounted print: the flag sits on a dark mat with an even reveal,
        // lifted by its own shadow. The artwork and the card share one aspect,
        // so the reveal is even by construction — and a mostly white flag gets
        // its border from the mat instead of from a hairline fighting the
        // scene.
        FlagImageView(
            assetID: assetID,
            accessibilityLabel: accessibilityLabel,
            store: store,
            assets: assets
        )
        .accessibilityHint(accessibilityHint)
        .clipShape(
            RoundedRectangle(cornerRadius: DesignTokens.Radius.small, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: DesignTokens.Radius.small, style: .continuous)
                .strokeBorder(.white.opacity(0.12), lineWidth: 1 / displayScale)
        }
        .shadow(color: .black.opacity(0.5), radius: 6, y: 3)
        .padding(DesignTokens.Card.matInset)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(white: DesignTokens.Card.matShade))
    }
}
