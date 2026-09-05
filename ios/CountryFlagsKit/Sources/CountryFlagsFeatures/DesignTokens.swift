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
        /// The shape of the release's artwork, not a choice of ours: every
        /// bundled flag is drawn on a 640×480 canvas, edge to edge. A card of
        /// any other proportion leaves bars beside every flag — bars the
        /// blurred ground then has to paper over, visibly on a light flag.
        /// Matching the artwork means the flag simply is the card.
        public static let aspectRatio: CGFloat = 4.0 / 3.0
        /// How far each card behind the top one sits, and how much smaller.
        /// The offset is large enough that what shows below the top card is
        /// recognisably the edge of another card — border, corners and all.
        /// Smaller values left a two-point sliver of the next flag's colours,
        /// which read as a rendering artifact rather than as a deck.
        public static let stackOffset: CGFloat = 14
        public static let stackScaleStep: CGFloat = 0.04
        /// How far a waiting card may lean and drift sideways. The values are
        /// derived from the card's own identity, so the pile looks thrown
        /// rather than fanned and every card holds its pose between renders —
        /// and straightens as it comes to the top.
        public static let scatterRotation: Double = 5
        public static let scatterOffset: CGFloat = 10
        /// How far the pile sways as it breathes: slow and autoreversing.
        /// Roughly half the scatter — enough to catch the corner of an eye,
        /// which the first, timider values did not.
        public static let breathRotation: Double = 2.4
        public static let breathOffset: CGFloat = 7
        /// The wash a card takes on as it is being thrown: the answer's
        /// colour, from the side the throw is going, never opaque enough to
        /// hide the flag.
        public static let swipeWashOpacity: Double = 0.35
        /// The lens over the flag: a faint sheen falling to a faint shade,
        /// so the card reads as glass over print rather than a picture
        /// pasted on.
        public static let lensSheenOpacity: Double = 0.1
        public static let lensShadeOpacity: Double = 0.12
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
        /// How much larger than the card the copy is drawn. A blur fades to
        /// nothing at the edges of the image it is given, and wherever that
        /// edge coincided with the card's, the fade showed as a pale stripe
        /// along the border. Oversized, the soft edge falls outside the clip
        /// and the card is covered wall to wall.
        /// Far enough that a thrown card is gone whatever the screen width.
        public static let leavingDistance: CGFloat = 900
        /// The card is the lit object on a dark scene, so it casts rather than
        /// floats: soft, low, never a hard edge.
        public static let shadowOpacity: Double = 0.35
        public static let shadowRadius: CGFloat = 24
        public static let shadowOffset: CGFloat = 12
        /// The margin a coat of arms keeps from the card's edge, as a share of
        /// the card's shorter side. Heraldry is drawn to its own outline — a
        /// crown above, supporters beside, a motto ribbon below — and an
        /// emblem pushed to the edge reads as one that was cropped. Twelve per
        /// cent is the floor `DESIGN.md` sets; the aspect-fit inside it is
        /// what keeps a wide achievement and a tall shield the same object.
        public static let coatInsetFraction: CGFloat = 0.12
        /// The plane a coat of arms is drawn on: neutral and dark, so the
        /// emblem's own tinctures are the only colour on the card. A flag
        /// fills its card; an emblem has to be put on something, and anything
        /// with a hue of its own would be a clue.
        public static let coatPlaneOpacity: Double = 0.86
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
        /// Both provider sign-in buttons, identical on purpose: two offers
        /// of the same thing must read as equals.
        ///
        /// Shorter than every other action in the app, and not by taste.
        /// Apple fixes the proportions of a Sign in with Apple button — the
        /// title is 43% of the height — for the system button and for any
        /// custom one alike, reviews every custom one, and offers no API for
        /// the label. So the height follows from the label rather than the
        /// other way round: a title at the body size, 17 points, is a button
        /// 40 points tall. At 44 the label was 19, the largest type on the
        /// screen; at the app's 56 it was 24. The guidelines allow down to 30.
        public static let providerButtonHeight: CGFloat = 40
        /// The label on both provider buttons: 43% of the height, which is
        /// what Apple draws on its own button and what ours matches beside it.
        public static let providerLabelSize: CGFloat = providerButtonHeight * 0.43
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
        /// The map on the country sheet: tall enough that a shape reads,
        /// short enough that the facts stay on the first screenful.
        /// The map is the sheet's closing block, full width and generous:
        /// the drawer ends on where the country is.
        public static let detailMapHeight: CGFloat = 300
        /// The flag-and-region row at the top of the details sheet: the flag
        /// keeps a fixed 4:3 plate and the region tile takes the rest.
        public static let detailPairHeight: CGFloat = 150
        public static let detailPairFlagWidth: CGFloat = 200
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
