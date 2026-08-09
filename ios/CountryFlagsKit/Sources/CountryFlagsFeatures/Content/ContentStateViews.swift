import SwiftUI

import CountryFlagsDomain

/// The banner above content that is on the device but may be out of date.
///
/// It explains rather than blocks: the catalog underneath stays scrollable and
/// every deck stays openable, which is the whole point of storing it.
struct ContentStatusBanner: View {
    let isStale: Bool
    let failure: ContentSyncFailure?

    var body: some View {
        if let message {
            Text(message)
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, DesignTokens.Spacing.medium)
                .padding(.vertical, DesignTokens.Spacing.small)
                .background(.quaternary, in: .rect(cornerRadius: DesignTokens.Radius.small))
                .accessibilityIdentifier(AccessibilityIdentifier.contentStatusBanner)
        }
    }

    private var message: String? {
        switch failure {
        case .offline: L10n.contentOffline
        case .clientTooOld: L10n.contentClientTooOld
        case .recoverable: L10n.contentRefreshFailed
        case nil: isStale ? L10n.contentStale : nil
        }
    }
}

/// What synchronisation is doing, when it is worth saying at all.
///
/// A healthy device that is up to date shows nothing. A guest is told their
/// work is saved rather than that something failed, because nothing has.
struct SyncStatusLine: View {
    let status: SyncStatus

    var body: some View {
        if let message {
            Text(message)
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier(AccessibilityIdentifier.syncStatus)
        }
    }

    private var message: String? {
        if status.isHeldForGuest, status.pendingCount > 0 {
            return L10n.syncSavedOnDevice(status.pendingCount)
        }
        switch status.lastFailure {
        case .offline: return L10n.syncOffline
        case .unauthorized: return L10n.syncSignInRequired
        case .throttled, .recoverable: return L10n.syncRetryLater
        case nil: return status.pendingCount > 0 ? L10n.syncPending(status.pendingCount) : nil
        }
    }
}

/// What a screen shows when there is nothing stored to show.
struct ContentUnavailableStateView: View {
    let failure: ContentSyncFailure?
    let retry: () async -> Void

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.medium) {
            Text(title)
                .font(DesignTokens.Typography.sectionTitle)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier(AccessibilityIdentifier.contentPlaceholderTitle)

            Text(message)
                .font(DesignTokens.Typography.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            // A retry that cannot help is not offered: an outdated build is
            // fixed in the App Store, not by asking again.
            if failure?.isRetryable ?? true {
                Button(L10n.contentRetry) {
                    Task { await retry() }
                }
                .buttonStyle(.borderedProminent)
                .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
                .accessibilityIdentifier(AccessibilityIdentifier.contentRetryButton)
            }
        }
        .padding(DesignTokens.Spacing.large)
        .frame(maxWidth: DesignTokens.Layout.maximumContentWidth)
    }

    private var title: String {
        switch failure {
        case .offline: L10n.contentOfflineTitle
        case .clientTooOld: L10n.contentClientTooOldTitle
        case .recoverable: L10n.contentFailedTitle
        case nil: L10n.contentEmptyTitle
        }
    }

    private var message: String {
        switch failure {
        case .offline: L10n.contentOfflineMessage
        case .clientTooOld: L10n.contentClientTooOldMessage
        case .recoverable: L10n.contentFailedMessage
        case nil: L10n.contentEmptyMessage
        }
    }
}

struct ContentLoadingStateView: View {
    var body: some View {
        VStack(spacing: DesignTokens.Spacing.medium) {
            ProgressView()
            Text(L10n.contentLoading)
                .font(DesignTokens.Typography.body)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier(AccessibilityIdentifier.contentLoadingLabel)
        }
        .padding(DesignTokens.Spacing.large)
    }
}

/// Draws a flag, or a placeholder when the bytes are missing or do not match
/// their checksum.
///
/// The placeholder is a real state rather than a blank: a country whose flag
/// failed still has to be readable and selectable, and an empty frame would
/// look like a layout bug instead of a missing download.
struct FlagImageView: View {
    let assetID: UUID
    let accessibilityLabel: String
    let store: ContentStore
    let assets: any AssetLoading

    @State private var image: Image?
    @State private var didFail = false

    var body: some View {
        Group {
            if let image {
                image
                    .resizable()
                    // A flag is a rectangle with a meaning; stretching it is a
                    // different flag.
                    .aspectRatio(contentMode: .fit)
            } else {
                placeholder
            }
        }
        .accessibilityLabel(accessibilityLabel)
        .accessibilityIdentifier(
            didFail
                ? AccessibilityIdentifier.flagPlaceholder
                : AccessibilityIdentifier.flagImage
        )
        .task(id: assetID) { await load() }
    }

    private var placeholder: some View {
        RoundedRectangle(cornerRadius: DesignTokens.Radius.small)
            .fill(.quaternary)
            .overlay {
                Image(systemName: didFail ? "flag.slash" : "flag")
                    .foregroundStyle(.secondary)
            }
    }

    private func load() async {
        guard let record = await store.asset(id: assetID) else {
            didFail = true
            return
        }
        guard let data = try? await assets.data(for: record),
            let platformImage = UIImage(data: data)
        else {
            didFail = true
            return
        }
        didFail = false
        image = Image(uiImage: platformImage)
    }
}
