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
        /// The out-of-focus copy of the flag that fills a card its own shape
        /// does not: enough blur that no edge of it reads as part of the flag.
        public static let groundBlur: CGFloat = 22
        public static let groundOpacity: Double = 0.85
        /// Far enough that a thrown card is gone whatever the screen width.
        public static let leavingDistance: CGFloat = 900
        /// The card is the lit object on a dark scene, so it casts rather than
        /// floats: soft, low, never a hard edge.
        public static let shadowOpacity: Double = 0.35
        public static let shadowRadius: CGFloat = 24
        public static let shadowOffset: CGFloat = 12
    }

    /// The ground every screen sits on.
    public enum Scene {
        /// Not quite black: a pure black ground makes the glass above it read
        /// as grey rather than as glass.
        public static let baseOpacity: Double = 0.94
        /// How far a light reaches. Larger than any phone is wide on purpose —
        /// the edge of a light must never be visible as an edge.
        public static let lightRadius: CGFloat = 420
        public static let groundLightRadius: CGFloat = 380
    }

    public enum Layout {
        /// The smallest side of an interactive element the platform
        /// guidelines allow.
        public static let minimumTouchTarget: CGFloat = 44
        /// The height of a primary action. Larger than the minimum on purpose:
        /// the rating row is pressed hundreds of times in a session, and a miss
        /// there costs a wrong interval rather than a wrong screen.
        public static let actionHeight: CGFloat = 56
        /// A flag beside a title rather than as the subject of the screen.
        public static let thumbFlagWidth: CGFloat = 64
        /// The rating names in the result, aligned so the bars start together.
        public static let ratingLabelWidth: CGFloat = 72
        /// The placeholder standing in for the counter while a session loads.
        public static let progressPlaceholderWidth: CGFloat = 88
        /// A flag in a list row: large enough to be recognised, small enough
        /// that the name beside it is still the thing being read.
        public static let rowFlagWidth: CGFloat = 44
        /// The bar under a deck on the progress screen.
        public static let progressBarHeight: CGFloat = 6
        public static let maximumContentWidth: CGFloat = 520
    }

    public enum Typography {
        public static let screenTitle: Font = .largeTitle.weight(.bold)
        /// The country on the back of a card: content rather than a label, so
        /// it takes the largest role there is room for.
        public static let cardAnswer: Font = .title2.weight(.bold)
        /// The score a session ends on: the largest thing the app ever draws,
        /// because it is the one number anybody repeats out loud.
        public static let resultScore: Font = .system(.largeTitle, design: .rounded, weight: .heavy)
        /// The one number a screen is built around, wherever a screen has one.
        /// The same face as the session result, one step down.
        public static let heroNumber: Font = .system(.largeTitle, design: .rounded, weight: .heavy)
        public static let sectionTitle: Font = .headline
        public static let body: Font = .body
        public static let caption: Font = .footnote
        /// Section labels are set apart by tracking rather than by a rule or a
        /// colour, which is the quietest way to mark a boundary on glass.
        public static let labelKerning: CGFloat = 1.2
    }
}
