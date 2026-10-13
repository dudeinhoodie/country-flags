import Foundation
import SwiftUI

import CountryFlagsDomain

/// What a cold launch opens on: the app's mark and its name on the scene
/// (#501).
///
/// A launch used to go from a blank system screen to a spinner and then to
/// Home drawn in placeholders, filling in as the catalogue and the counts
/// arrived — three screens in the first two seconds, two of them grey
/// shapes: an app assembling itself in front of the person who opened it.
/// So the first screen is now one that is finished on the first frame: the
/// sheet from the icon that was tapped, on the navy the system's launch
/// screen already showed, with the name under it, held until Home has
/// something real to show and then faded into it. The layout is the owner's
/// preview (13.10); `DesignTokens.Splash` holds its measurements.
///
/// It holds no information and nothing on it can be pressed, so it is never
/// allowed to hold anything back. It gives way at once to a screen with a
/// message on it, and after a short cap to whatever is still loading. The
/// rules are in `LaunchSplash`, where they can be checked without a screen.
///
/// Still on purpose: the design language rules out an animated splash, and a
/// mark that moves is asking to be watched. The only motion is the fade out.
struct LaunchSplashScreen: View {
    /// The name the home screen shows under the icon, so the splash names the
    /// build that was tapped.
    var appName: String = LaunchSplash.appName(
        bundleDisplayName: Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName")
            as? String
    )

    /// The text size's step from the default, so the name follows Dynamic
    /// Type on top of following the screen's width.
    @ScaledMetric(relativeTo: .largeTitle) private var textScale: CGFloat = 1

    var body: some View {
        // The whole screen, status bar included: the preview's measurements
        // are taken from its top edge.
        GeometryReader { proxy in
            let width = proxy.size.width
            let markWidth = width * DesignTokens.Splash.markWidthShare
            let markHeight = markWidth * DesignTokens.Splash.markAspect

            VStack(spacing: width * DesignTokens.Splash.nameSpacingShare) {
                // The sheet comes with the navy around it, so the box needs
                // no shape of its own: on the same navy it has no edge.
                Image("AppMark", bundle: .module)
                    .resizable()
                    .interpolation(.high)
                    .frame(width: markWidth, height: markHeight)

                Text(appName)
                    .font(
                        .system(
                            size: width * DesignTokens.Splash.nameSizeShare * textScale,
                            weight: .bold
                        )
                    )
                    .foregroundStyle(DesignTokens.Splash.name)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, DesignTokens.Spacing.large)
            }
            // Placed by the mark's centre rather than centred as a group, so
            // a name that grows with Dynamic Type grows downwards and the
            // mark stays where the preview put it.
            .padding(.top, proxy.size.height * DesignTokens.Splash.markCentreShare - markHeight / 2)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .background(DesignTokens.Splash.ground)
        .ignoresSafeArea()
        // The whole screen takes the touch, so nothing behind it can be
        // pressed by accident while it is up.
        .contentShape(Rectangle())
        // One element, read as the app's name: the mark is the same name in
        // a picture, and reading it twice says nothing new.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(appName)
        .accessibilityIdentifier(AccessibilityIdentifier.splash)
    }
}

/// When the launch splash gives way, and to what.
///
/// Free functions of the launch's state rather than properties of a view, so
/// the rules can be checked without a screen — the same reason
/// `LaunchWaitScreen.Reason.waiting` is one.
enum LaunchSplash {
    /// How long the splash may stand in front of a launch that is not ready.
    ///
    /// Two and a half seconds. A guest is ready in well under one: their
    /// numbers are counted on the device and the catalogue is on it from the
    /// first launch. An account's launch run is a handful of requests in a
    /// row — what is waiting to go up, the change stream, the counts — which
    /// a warm backend answers on an ordinary connection in about a second;
    /// the cap leaves room for a slower phone or a weaker signal on top of
    /// that. It stops short of a backend waking from zero, which takes
    /// several seconds, and of the three seconds after which a launch starts
    /// to read as hung. Past it the splash is the wrong screen: the loading
    /// views underneath say what is being waited for, and the mark does not.
    static let cap: Duration = .milliseconds(2500)

    /// How long the splash holds once the screen behind it is ready, before
    /// it starts to fade.
    ///
    /// Home cross-fades out of its placeholder in 0.2 seconds when the counts
    /// land, and readiness is that same moment. Faded at once, the splash
    /// showed the placeholder's last frames through itself — the skeleton
    /// this screen exists to replace, as a ghost.
    static let settle: Duration = .milliseconds(200)

    /// The fade into what is behind: a wait the learner sits through, so
    /// within the 0.35 seconds the design language gives one.
    static let fade: Animation = .smooth(duration: 0.35)

    /// Where the splash is in leaving. It only ever moves forward: a cold
    /// launch has one splash, and coming back from the background, a pull to
    /// refresh or a sign-in never brings it back.
    enum Phase: Equatable {
        /// Up, covering the launch.
        case shown
        /// Fading. Nothing on it can be pressed any more: what is behind it is
        /// already there, and a tap meant for it lands on it.
        case leaving
        /// Gone from the hierarchy.
        case gone
    }

    /// What the splash is standing in front of.
    enum Behind: Equatable {
        /// The launch wait, still waiting: a spinner and a line about the
        /// flags or the account. A loading view, which is what the splash
        /// replaces.
        case launchWait
        /// The launch wait saying the server could not be reached, with its
        /// retry. A message, and the splash must never sit on it.
        case launchFailure
        /// Home drawing its placeholder while the counts are on the way.
        case homeLoading
        /// Home with something real on it: the day, or one of its own
        /// screens for a catalogue that is empty or could not be fetched,
        /// each with its words and its retry.
        case home
    }

    /// What is behind the splash, read off the same values the screens
    /// behind it are drawn from.
    ///
    /// - Parameters:
    ///   - isLaunchWaiting: whether the launch wait is up rather than Home.
    ///   - launchWaitFails: whether that wait is reporting a failure
    ///     (`LaunchWaitScreen.reportsFailure`).
    ///   - catalog: the catalogue as Home switches on it.
    ///   - isAwaitingProgress: Home's own test for counts that have never
    ///     arrived.
    ///   - isSettling: the windows Home is told the numbers are about to
    ///     change in — the launch's own run among them.
    static func behind(
        isLaunchWaiting: Bool,
        launchWaitFails: Bool,
        catalog: ContentViewState<[CatalogSection]>,
        isAwaitingProgress: Bool,
        isSettling: Bool
    ) -> Behind {
        if isLaunchWaiting {
            return launchWaitFails ? .launchFailure : .launchWait
        }
        switch catalog {
        case .loading:
            // Home's whole-screen placeholder. The launch wait holds the app
            // until there is a catalogue, so this is not expected behind the
            // splash — but if it ever is, it is a placeholder like the other.
            return .homeLoading
        case .empty, .failed:
            return .home
        case .ready:
            // The condition that ends Home's own placeholder, exactly: a
            // splash that left earlier would show it, and one that left later
            // would hide a finished screen.
            return isAwaitingProgress || isSettling ? .homeLoading : .home
        }
    }

    /// Whether the splash should give way now.
    ///
    /// At once to anything with something to say; after the cap to a screen
    /// that is still loading, because a slow network must never be held
    /// behind the app's name.
    static func givesWay(to behind: Behind, hasTimedOut: Bool) -> Bool {
        switch behind {
        case .launchFailure, .home: true
        case .launchWait, .homeLoading: hasTimedOut
        }
    }

    /// The name to put under the mark.
    ///
    /// The bundle's display name — the one under the icon on the home screen
    /// — so a Dev build says so the way its icon does, and a rename is a
    /// build setting rather than a string to find. The shell's title is the
    /// fallback for a bundle that has none, a test host's for one.
    static func appName(bundleDisplayName: String?) -> String {
        guard let name = bundleDisplayName?.trimmingCharacters(in: .whitespacesAndNewlines),
            !name.isEmpty
        else {
            return L10n.shellTitle
        }
        return name
    }
}
