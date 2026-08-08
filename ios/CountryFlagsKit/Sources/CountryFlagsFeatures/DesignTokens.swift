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
