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
                SafariDocumentView(url: DocumentURL.localized(url))
                    // The controller draws its own bars to the screen's edge.
                    .ignoresSafeArea()
            }
    }
}

/// The address a document is opened at: the configured one, told which
/// language the app is showing.
///
/// The site keeps one address per document and picks the text by `?lang=`
/// (ADR-023), so the app says what it is being read in rather than shipping
/// a URL per language. What it says is the language of its own interface —
/// the localization the bundle actually resolved — not the phone's first
/// preference, which may be a language the app has no words in. The site
/// falls back to English on its own for anything it has not published.
enum DocumentURL {
    static let languageParameter = "lang"

    static func localized(_ url: URL, language: String? = Bundle.module.preferredLocalizations.first) -> URL {
        guard let language = baseLanguage(of: language),
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return url }
        // Replace rather than append: a configured address may already carry
        // the parameter, and two answers to one question is no answer.
        var items = (components.queryItems ?? []).filter { $0.name != languageParameter }
        items.append(URLQueryItem(name: languageParameter, value: language))
        components.queryItems = items
        return components.url ?? url
    }

    /// `ru`, whether the localization came as `ru`, `ru-RU` or `ru_RU`. The
    /// site addresses documents by language alone, so the region is dropped.
    static func baseLanguage(of identifier: String?) -> String? {
        guard let identifier, !identifier.isEmpty else { return nil }
        let normalized = identifier.replacingOccurrences(of: "_", with: "-")
        guard let language = Locale.Language(identifier: normalized).languageCode?.identifier,
              !language.isEmpty
        else { return nil }
        return language.lowercased()
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
