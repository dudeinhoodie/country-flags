import Foundation

/// Runs a pull-to-refresh action and keeps the gesture open for a moment,
/// even when the work is over at once.
///
/// The system starts the action the instant the pull crosses its threshold,
/// while the finger is still down. Work that answers in a few milliseconds —
/// a backend that refuses the connection outright, a run already in flight
/// that the new request simply joins, a store that is already current — ends
/// the refresh under a finger that is still pulling, and the scroll view is
/// left where the finger held it: the spinner gone, the content pushed down,
/// nothing moving until the next scroll. Holding the gesture a moment past
/// the work lets the finger lift first, so the retraction animates the way it
/// does after a slow refresh.
///
/// It is also what makes an instant answer legible as one: a refresh that
/// ends before it is seen looks like one that never began.
enum RefreshGesture {
    /// Long enough for a finger to lift; short enough not to read as a wait.
    static let minimumDuration: Duration = .milliseconds(800)

    /// On the main actor, where the gesture runs and where the stores live.
    @MainActor
    static func perform(_ work: @MainActor @Sendable () async -> Void) async {
        let began = ContinuousClock.now
        await work()
        let elapsed = ContinuousClock.now - began
        if elapsed < minimumDuration {
            try? await Task.sleep(for: minimumDuration - elapsed)
        }
    }
}
