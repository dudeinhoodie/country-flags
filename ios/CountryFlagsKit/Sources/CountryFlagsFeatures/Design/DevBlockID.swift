import SwiftUI

/// The names of a screen's blocks, drawn on the screen in a development
/// build.
///
/// A review on a phone goes faster when the reviewer can say "home.regions is
/// too tall" instead of describing where on the screen they mean. The names
/// are drawn only while the switch in the settings' developer section is on,
/// and that section exists only in the environments that allow debug
/// affordances, so a production build never shows them.
enum DevBlockIDs {
    /// The switch's key. A production build has a bundle of its own and so a
    /// defaults domain of its own, which this key is never written to.
    static let storageKey = "dev.showBlockIDs"
}

private struct DevBlockIDModifier: ViewModifier {
    let id: String
    @AppStorage(DevBlockIDs.storageKey) private var isShown = false

    func body(content: Content) -> some View {
        content.overlay(alignment: .topLeading) {
            if isShown {
                ZStack(alignment: .topLeading) {
                    Rectangle()
                        .strokeBorder(
                            .yellow.opacity(0.8),
                            style: StrokeStyle(lineWidth: 1, dash: [4, 3])
                        )
                    Text(id)
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundStyle(.black)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(.yellow, in: RoundedRectangle(cornerRadius: 3, style: .continuous))
                }
                // A label for the reviewer, not part of the screen: it takes
                // no touches and says nothing to VoiceOver.
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
        }
    }
}

extension View {
    /// Names this block for a reviewer; drawn only when the developer switch
    /// is on.
    func devBlockID(_ id: String) -> some View {
        modifier(DevBlockIDModifier(id: id))
    }
}
