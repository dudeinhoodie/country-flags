import SwiftUI

import CountryFlagsDomain

/// The root shell of the app.
///
/// There are no screens yet: this work package fixes the navigation topology
/// and the rule that a view receives its state instead of creating it.
public struct RootView: View {
    @State private var router: AppRouter
    private let configuration: RuntimeConfiguration

    public init(router: AppRouter, configuration: RuntimeConfiguration) {
        _router = State(wrappedValue: router)
        self.configuration = configuration
    }

    public var body: some View {
        NavigationStack(path: $router.navigationPath) {
            shell
                .navigationDestination(for: AppRoute.self) { route in
                    RouteView(route: route)
                }
        }
    }

    private var shell: some View {
        VStack(spacing: DesignTokens.Spacing.large) {
            Text(L10n.shellTitle)
                .font(DesignTokens.Typography.screenTitle)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier(AccessibilityIdentifier.shellTitle)

            Text(L10n.shellSubtitle)
                .font(DesignTokens.Typography.body)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)

            Button(L10n.shellOpenSettings) {
                router.push(.settings)
            }
            .buttonStyle(.borderedProminent)
            .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
            .accessibilityIdentifier(AccessibilityIdentifier.openSettingsButton)

            if configuration.environment.allowsDebugAffordances {
                Text(verbatim: configuration.environment.rawValue.uppercased())
                    .font(DesignTokens.Typography.caption)
                    .padding(.horizontal, DesignTokens.Spacing.small)
                    .padding(.vertical, DesignTokens.Spacing.extraSmall)
                    .background(.quaternary, in: .rect(cornerRadius: DesignTokens.Radius.small))
                    .accessibilityIdentifier(AccessibilityIdentifier.environmentBadge)
            }
        }
        .padding(DesignTokens.Spacing.large)
        .frame(maxWidth: DesignTokens.Layout.maximumContentWidth)
    }
}

/// A placeholder destination: real screens arrive with their own work
/// packages, while the route is already typed and covered by a UI test.
struct RouteView: View {
    let route: AppRoute

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.medium) {
            Text(title)
                .font(DesignTokens.Typography.sectionTitle)
                .accessibilityIdentifier(AccessibilityIdentifier.routeTitle)
            Text(L10n.routeNotImplemented)
                .font(DesignTokens.Typography.body)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .padding(DesignTokens.Spacing.large)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var title: String {
        switch route {
        case .catalog: L10n.catalogTitle
        case .deck: L10n.deckTitle
        case .progress: L10n.progressTitle
        case .settings: L10n.settingsTitle
        }
    }
}

/// Identifiers for UI tests. They are never localized, so a test does not
/// depend on the language of the simulator.
///
/// Every identifier sits on a leaf view. An accessibility identifier applied to
/// a SwiftUI container propagates to its descendants and overrides the ones
/// they set themselves, which makes the children indistinguishable in a query.
public enum AccessibilityIdentifier {
    public static let shellTitle = "root.shell.title"
    public static let openSettingsButton = "root.shell.openSettings"
    public static let environmentBadge = "root.shell.environmentBadge"
    public static let routeTitle = "root.route.title"
    public static let adSlot = "ads.slot"
}
