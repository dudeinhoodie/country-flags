import SwiftUI

/// The minimal set of design tokens.
///
/// Screens never spell out spacing or radii as numbers; the values come from
/// here so later work packages change the scale in one place. Typography builds
/// on system text styles, which supports Dynamic Type without extra work.
public enum DesignTokens {
    public enum Spacing {
        public static let extraSmall: CGFloat = 4
        public static let small: CGFloat = 8
        public static let medium: CGFloat = 16
        public static let large: CGFloat = 24
        public static let extraLarge: CGFloat = 32
    }

    public enum Radius {
        public static let small: CGFloat = 8
        public static let medium: CGFloat = 12
        public static let large: CGFloat = 20
    }

    /// The study card and the stack it sits in.
    ///
    /// The numbers live here rather than in the view for the same reason every
    /// other measure does, and because two of them are the feel of the gesture:
    /// how far a card travels before it counts as an answer, and how much it
    /// leans on the way.
    public enum Card {
        /// A flag is a rectangle with a meaning, and the card keeps its shape.
        public static let aspectRatio: CGFloat = 3.0 / 2.0
        /// How far each card behind the top one sits, and how much smaller.
        public static let stackOffset: CGFloat = 10
        public static let stackScaleStep: CGFloat = 0.04
        /// Cards drawn behind the top one. A thicker stack reads as depth
        /// rather than as more information.
        public static let stackDepth: Int = 3
        /// Past this, letting go answers the card. Below it, the card returns.
        public static let swipeThreshold: CGFloat = 96
        /// Degrees of lean per point dragged.
        public static let swipeRotation: Double = 1.0 / 22.0
        /// The hairline that keeps a white flag from dissolving into the page.
        public static let borderOpacity: Double = 0.12
    }

    public enum Layout {
        /// The smallest side of an interactive element the platform
        /// guidelines allow.
        public static let minimumTouchTarget: CGFloat = 44
        public static let maximumContentWidth: CGFloat = 520
    }

    public enum Typography {
        public static let screenTitle: Font = .largeTitle.weight(.bold)
        public static let sectionTitle: Font = .headline
        public static let body: Font = .body
        public static let caption: Font = .footnote
    }
}
