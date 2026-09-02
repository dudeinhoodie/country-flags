import SafariServices
import SwiftUI
import UIKit

/// A published document, opened without leaving the app.
///
/// `Link` hands the address to Safari and the app goes to the background,
/// which is the wrong shape for these two: the privacy policy and the terms
/// are read for a moment and closed, and being ejected from an app to read
/// what it promises is a small betrayal of the promise.
///
/// `SFSafariViewController` rather than a bare web view: it is the platform's
/// own in-app browser, so the page arrives with a real address bar, Reader,
/// sharing and the system's cookie jar — none of which we would build, and the
/// absence of which is what makes an in-app browser feel like a trap. It also
/// costs no maintenance, which a hand-rolled navigation chrome would.
struct DocumentLink: View {
    let title: String
    let url: URL

    @State private var isOpen = false

    var body: some View {
        Button(title) { isOpen = true }
            .sheet(isPresented: $isOpen) {
                SafariDocumentView(url: url)
                    // The controller draws its own bars to the screen's edge.
                    .ignoresSafeArea()
            }
    }
}

/// The system's in-app browser, in the app's colours.
private struct SafariDocumentView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let configuration = SFSafariViewController.Configuration()
        // Nothing here is a page to skim: Reader would hide the headings the
        // documents are navigated by, and the bar collapsing on scroll makes
        // the way out disappear halfway down a policy.
        configuration.entersReaderIfAvailable = false
        configuration.barCollapsingEnabled = false

        let controller = SFSafariViewController(url: url, configuration: configuration)
        controller.dismissButtonStyle = .close
        // The app is dark everywhere, so its browser is too — otherwise the
        // sheet arrives as a white rectangle out of a black screen.
        controller.preferredBarTintColor = .black
        controller.preferredControlTintColor = .white
        return controller
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
