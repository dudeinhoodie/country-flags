import SwiftUI

import CountryFlagsDomain

/// The question side of a card, drawn by the template that asks it.
///
/// This is the whole of the renderer selection: a card names a
/// `templateCode + templateSchemaVersion`, `CardTemplateRegistry` turns the
/// pair into a template, and the switch below turns the template into a face.
/// The deck the card came from is never consulted — a deck can hold two
/// templates and two decks can hold one, so its name is not evidence about
/// what to draw. Adding a case to `CardTemplate` breaks this switch, which is
/// how a registered template without a face is caught at compile time.
///
/// Both sessions draw their prompt through here, which is what keeps a deck
/// card and a quiz card the same object in two places.
struct CardFaceView: View {
    let face: CardFace
    let assetID: UUID
    /// Whether the label may name what the card is about. False everywhere
    /// the question is still open: a screen reader that reads the answer off
    /// the front has answered it for the learner, so before then the label
    /// says what kind of symbol this is and nothing more.
    let namesSubject: Bool
    /// The answer, used only where naming it is allowed.
    let displayName: String
    var accessibilityHint: String = ""
    let store: ContentStore
    let assets: any AssetLoading

    var body: some View {
        switch face {
        case .template(.flagToCountry):
            FlagCardFace(
                assetID: assetID,
                accessibilityLabel: label(unrevealed: L10n.studyFlagPrompt),
                accessibilityHint: hint,
                store: store,
                assets: assets
            )
        case .template(.coatOfArmsToCountry):
            CoatOfArmsCardFace(
                assetID: assetID,
                accessibilityLabel: label(unrevealed: L10n.studyCoatPrompt),
                accessibilityHint: hint,
                store: store,
                assets: assets
            )
        case .unsupported:
            UnsupportedCardFace()
        case .pending:
            // The store is being read. A plate rather than a spinner: the
            // wait is one store read long and a spinner on a card in a stack
            // reads as a card that is broken.
            PendingCardFace()
        }
    }

    private func label(unrevealed: String) -> String {
        namesSubject ? displayName : unrevealed
    }

    private var hint: String {
        namesSubject ? "" : accessibilityHint
    }
}

/// The face of a card whose subject is a coat of arms.
///
/// An emblem is not a flag with different colours. A flag is drawn to the
/// edges of a rectangle and can therefore be the card; heraldry is drawn to
/// its own outline — a crown above, supporters beside, a motto ribbon below —
/// and has to be set on something. That something is a neutral dark plane:
/// anything with a hue of its own would be a clue, and the emblem's own
/// tinctures are the only colour the card is allowed.
///
/// The inset is the other half of the same rule. Aspect-fit alone would put
/// a wide achievement's supporters against the card's border and read as a
/// crop, so the drawing keeps a margin of its own before it is fitted.
struct CoatOfArmsCardFace: View {
    let assetID: UUID
    let accessibilityLabel: String
    var accessibilityHint: String = ""
    let store: ContentStore
    let assets: any AssetLoading

    var body: some View {
        // The plane is drawn under the emblem rather than behind the card, so
        // it is there whatever the card's own background is — the quiz draws
        // this face without a stack under it.
        GeometryReader { proxy in
            let inset = min(proxy.size.width, proxy.size.height)
                * DesignTokens.Card.coatInsetFraction

            FlagImageView(
                assetID: assetID,
                accessibilityLabel: accessibilityLabel,
                store: store,
                assets: assets,
                missing: .coatOfArms
            )
            .padding(inset)
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .background(plane)
        .accessibilityHint(accessibilityHint)
        .overlay {
            // The same lens the flag card wears, so a coat and a flag are two
            // faces of one object rather than two designs.
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
    }

    /// Neutral and dark, and dark in both appearances: the plane is the
    /// exhibit's mount, not the room's wall, and an emblem drawn for a white
    /// ground is the rare one.
    private var plane: some View {
        ZStack {
            Color.black
            Rectangle().fill(.ultraThinMaterial)
            Color.black.opacity(1 - DesignTokens.Card.coatPlaneOpacity)
        }
    }
}

/// The card between appearing and knowing what it is.
struct PendingCardFace: View {
    var body: some View {
        ZStack {
            Color.black
            Rectangle().fill(.ultraThinMaterial)
        }
        // Nothing to say yet, and nothing to read: an element with no label
        // is skipped, which is right for a card whose content has not
        // arrived.
        .accessibilityHidden(true)
    }
}

/// A card whose template this build has no renderer for.
///
/// It exists for one case, and the case is rare on purpose: a card of an
/// unknown template is dropped when a session is composed, so a new session
/// never contains one. What reaches here is a session composed elsewhere — by
/// the backend, or by a later build whose session this one resumed — and the
/// honest answer for it is to say so. Drawing it with the nearest renderer
/// would put a coat of arms in a flag's frame, which is the failure the whole
/// registry exists to prevent.
struct UnsupportedCardFace: View {
    var body: some View {
        ScrollView {
            VStack(spacing: DesignTokens.Spacing.medium) {
                Image(systemName: "square.on.square.dashed")
                    .font(.largeTitle)
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(.white.opacity(0.6))

                Text(L10n.studyCardUnsupportedTitle)
                    .font(DesignTokens.Typography.sectionTitle)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)

                Text(L10n.studyCardUnsupportedMessage)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.7))
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(DesignTokens.Spacing.large)
        }
        // The copy grows with the reader's text size, and the card cannot
        // grow with it: a 4:3 plate is the one thing the stack holds fixed.
        // So the words scroll inside it rather than being clipped by it.
        .scrollIndicators(.hidden)
        .scrollBounceBehavior(.basedOnSize)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            ZStack {
                Color.black
                Rectangle().fill(.ultraThinMaterial)
            }
        }
        // One thing to hear, and it says what happened rather than naming a
        // country nobody can see.
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(AccessibilityIdentifier.studyCardUnsupported)
    }
}
