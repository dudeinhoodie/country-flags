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
            Label {
                Text(message)
                    .font(DesignTokens.Typography.caption)
                    .accessibilityIdentifier(AccessibilityIdentifier.contentStatusBanner)
            } icon: {
                Image(systemName: "exclamationmark.circle")
                    .symbolRenderingMode(.hierarchical)
            }
            .foregroundStyle(.white.opacity(0.75))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, DesignTokens.Spacing.medium)
            .padding(.vertical, DesignTokens.Spacing.small)
            .glassEffect(
                .regular,
                in: .rect(cornerRadius: DesignTokens.Radius.medium, style: .continuous)
            )
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

/// What synchronisation is doing, in the header beside the avatar and the
/// gear.
///
/// A healthy device that is up to date shows nothing. Of the two things worth
/// a place up there, unsent answers come first: they are the concrete thing —
/// a number the learner recognises as their own work — and no signal is
/// merely one of the reasons they are still here.
///
/// The chip is small, so the sentence moves to its label rather than
/// disappearing: a guest is still told that signing in is what carries the
/// answers over, and VoiceOver reads that instead of a bare number.
struct SyncStatusChip: View {
    let status: SyncStatus
    /// The queue just drained: the chip says so before it says nothing.
    @State private var showsSynced = false

    init(status: SyncStatus) {
        self.status = status
    }
    /// Which drain the fade-out belongs to, so a new success restarts the
    /// three seconds instead of being cut short by the previous timer.
    @State private var successGeneration = 0

    var body: some View {
        Group {
            if let state {
                HStack(spacing: DesignTokens.Spacing.extraSmall) {
                    Image(systemName: state.symbol)
                        .accessibilityHidden(true)
                    Text(state.title)
                        .accessibilityIdentifier(AccessibilityIdentifier.syncStatus)
                        .accessibilityLabel(state.spoken)
                }
                .font(DesignTokens.Typography.caption)
                .monospacedDigit()
                // The whole chip turns green for the made-it moment — the
                // colour change is the celebration, animated so it arrives
                // rather than snaps — and white otherwise.
                .foregroundStyle(showsSynced ? Color.green : .white)
                .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.45), value: showsSynced)
        .animation(.easeInOut(duration: 0.35), value: status.pendingCount)
        // The moment the queue empties is worth a word of its own: a counter
        // that silently vanishes reads as "gave up", not "made it". The word
        // holds for three seconds and fades on its own.
        .onChange(of: status.pendingCount) { previous, current in
            guard previous > 0, current == 0, status.lastFailure == nil else { return }
            showsSynced = true
            successGeneration += 1
            let generation = successGeneration
            Task {
                try? await Task.sleep(for: .seconds(3))
                if generation == successGeneration {
                    showsSynced = false
                }
            }
        }
    }

    private struct Presentation {
        let symbol: String
        let title: String
        /// What the chip would have said if it had room. Also the line the
        /// UI tests read, so the meaning stays checkable in one place.
        let spoken: String
    }

    /// Unsent answers win over everything; the success word holds the spot
    /// they just left; a missing signal comes after; a healthy, empty queue
    /// says nothing at all.
    private var state: Presentation? {
        if status.pendingCount > 0 {
            return Presentation(
                symbol: "arrow.up.circle",
                title: L10n.syncPendingChip(status.pendingCount),
                spoken: status.isHeldForGuest
                    ? L10n.syncSavedOnDevice(status.pendingCount)
                    : L10n.syncPending(status.pendingCount)
            )
        }
        if showsSynced {
            return Presentation(
                symbol: "checkmark.circle",
                title: L10n.syncSynced,
                spoken: L10n.syncSynced
            )
        }
        // Without a queue there is nothing waiting, but a learner about to
        // answer still wants to know the answers will not leave yet.
        if status.lastFailure == .offline {
            return Presentation(
                symbol: "wifi.slash",
                title: L10n.syncOfflineShort,
                spoken: L10n.syncOffline
            )
        }
        return nil
    }
}

/// What a screen shows when there is nothing stored to show.
///
/// The same shape as the one a session shows when it cannot start: a symbol,
/// what happened, what to do about it, and at most one button. A learner who
/// meets both in the same week should recognise the second from the first.
struct ContentUnavailableStateView: View {
    let failure: ContentSyncFailure?
    let retry: () async -> Void

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.medium) {
            Spacer(minLength: 0)

            Image(systemName: symbol)
                .font(DesignTokens.Typography.screenTitle)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(.white.opacity(0.8))

            Text(title)
                .font(DesignTokens.Typography.sectionTitle)
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier(AccessibilityIdentifier.contentPlaceholderTitle)

            Text(message)
                .font(DesignTokens.Typography.body)
                .foregroundStyle(.white.opacity(0.65))
                .multilineTextAlignment(.center)

            Spacer(minLength: 0)

            // A retry that cannot help is not offered: an outdated build is
            // fixed in the App Store, not by asking again.
            if failure?.isRetryable ?? true {
                Button(L10n.contentRetry) {
                    Task { await retry() }
                }
                .buttonStyle(PrimaryActionStyle())
                .accessibilityIdentifier(AccessibilityIdentifier.contentRetryButton)
            }
        }
        .frame(maxWidth: DesignTokens.Layout.maximumContentWidth)
        .frame(maxWidth: .infinity)
        .padding(DesignTokens.Spacing.large)
        .sceneChrome()
    }

    /// Shape as well as words: being offline and being out of date are
    /// different problems and must not look like the same one.
    private var symbol: String {
        switch failure {
        case .offline: "wifi.slash"
        case .clientTooOld: "arrow.down.circle"
        case .recoverable: "exclamationmark.triangle"
        case nil: "tray"
        }
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

/// What a browsing screen looks like while it is being filled.
///
/// Blocks in the proportions the screen will have rather than a spinner: the
/// layout is already known, so it is drawn, and the content arrives into it.
/// The label is kept for the reader who is being spoken to rather than shown.
struct ContentLoadingStateView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.large) {
            // The shape of what is coming, not a stack of anonymous bars: a
            // pane with a heading and a number, then a shelf of flags. A
            // placeholder that matches the layout it will become is the one
            // thing that stops the screen jumping when it does.
            SkeletonBlock(height: DesignTokens.Layout.actionHeight * 2.5)

            HStack(spacing: DesignTokens.Spacing.small) {
                ForEach(0..<4, id: \.self) { _ in
                    SkeletonBlock(
                        height: DesignTokens.Layout.rowFlagWidth * 0.75,
                        radius: DesignTokens.Radius.small
                    )
                }
            }

            VStack(spacing: DesignTokens.Spacing.small) {
                ForEach(0..<2, id: \.self) { _ in
                    SkeletonBlock(height: DesignTokens.Layout.actionHeight * 1.4)
                }
            }

            Spacer(minLength: 0)
        }
        .frame(maxWidth: DesignTokens.Layout.maximumContentWidth)
        .frame(maxWidth: .infinity)
        .padding(DesignTokens.Spacing.large)
        .accessibilityElement()
        .accessibilityLabel(L10n.contentLoading)
        .accessibilityIdentifier(AccessibilityIdentifier.contentLoadingLabel)
        .sceneChrome()
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
    /// `.fit` everywhere the flag is the subject — nothing crops or stretches
    /// it. `.fill` exists for one job: painting a ground out of the flag's own
    /// colours behind the flag itself, where the crop is the point and the
    /// result is never read as the flag.
    var contentMode: ContentMode = .fit

    @State private var image: Image?
    @State private var didFail = false

    var body: some View {
        Group {
            if let image {
                image
                    .resizable()
                    // A flag is a rectangle with a meaning; stretching it is a
                    // different flag.
                    .aspectRatio(contentMode: contentMode)
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
        RoundedRectangle(cornerRadius: DesignTokens.Radius.small, style: .continuous)
            .fill(.ultraThinMaterial)
            .overlay {
                Image(systemName: didFail ? "flag.slash" : "flag")
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(.white.opacity(0.5))
            }
    }

    private func load() async {
        guard let record = await store.asset(id: assetID),
            let resolved = await FlagImageResolver(assets: assets).image(for: record)
        else {
            // The previous flag is cleared rather than left behind: this view
            // keeps its identity across cards in the quiz, and a failure that
            // kept the old image would put one country's flag over another
            // country's question.
            image = nil
            didFail = true
            return
        }
        didFail = false
        image = resolved
    }
}
