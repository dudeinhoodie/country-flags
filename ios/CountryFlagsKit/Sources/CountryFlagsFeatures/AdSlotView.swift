import SwiftUI

import CountryFlagsDomain

/// Whether a placement takes any room on screen.
///
/// A slot is either filled or absent. There is no "reserved but empty" state:
/// a placeholder that keeps its height when nothing loads pushes the content
/// the user came for down the screen for no reason, and it is the state a
/// no-fill, a provider error and a switched-off placement would all land in.
public enum AdSlotPresentation: Hashable, Sendable {
    case hidden
    case filled

    public init(eligibility: AdEligibility, loadResult: AdLoadResult) {
        switch (eligibility, loadResult) {
        case (.allowed, .ready): self = .filled
        default: self = .hidden
        }
    }
}

/// The place a banner or a native unit would appear.
///
/// The view imports no ad SDK and knows no provider. With the no-op provider —
/// the only one the app ships — the presentation is always `.hidden` and the
/// view contributes nothing to the layout.
public struct AdSlotView: View {
    private let presentation: AdSlotPresentation
    private let content: () -> AnyView

    public init(
        presentation: AdSlotPresentation,
        @ViewBuilder content: @escaping () -> some View
    ) {
        self.presentation = presentation
        self.content = { AnyView(content()) }
    }

    /// The slot as the MVP composes it: nothing is eligible and nothing loads.
    public init(eligibility: AdEligibility, loadResult: AdLoadResult) {
        self.init(presentation: AdSlotPresentation(eligibility: eligibility, loadResult: loadResult)) {
            EmptyView()
        }
    }

    public var body: some View {
        switch presentation {
        case .hidden:
            // Not a zero-height frame: an empty view adds no spacing to the
            // stack that contains it either.
            EmptyView()
        case .filled:
            content()
                .accessibilityIdentifier(AccessibilityIdentifier.adSlot)
        }
    }
}
