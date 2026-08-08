import SwiftUI

import CountryFlagsDomain

/// The place a placement would occupy.
///
/// Advertising is off in the MVP, so this view renders nothing at all. That is
/// the point: a reserved frame waiting for a provider is a blank rectangle on
/// every screen it appears on, and it pushes the content down whether or not
/// anything ever fills it. The slot takes space only once something is really
/// there to draw.
public struct AdSlotView: View {
    private let slot: AdSlot

    public init(slot: AdSlot) {
        self.slot = slot
    }

    public var body: some View {
        if slot.isVisible {
            Color.clear
                .frame(height: slot.reservedHeight)
                .accessibilityIdentifier(AccessibilityIdentifier.adSlot(slot.placement))
                .accessibilityLabel(L10n.advertisementLabel)
        }
    }
}
