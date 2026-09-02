import SwiftUI

import CountryFlagsDomain

/// What this build is, and whose work it stands on.
///
/// Two obligations meet on one screen. The flags are redistributed under the
/// MIT licence, which asks that its notice travel with them — the app ships
/// around two hundred and fifty of them, so the notice belongs where a reader
/// can find it rather than in a repository nobody using the app will open.
/// And a version number is what somebody reporting a problem is asked for
/// first; until now it was visible only in builds that carry a debug badge.
///
/// A plain form, like the settings screen it opens from, for the same reason:
/// this is a document, and iOS already draws documents.
struct AboutScreen: View {
    let version: String
    let build: String
    let privacyPolicyURL: URL?
    let termsURL: URL?

    var body: some View {
        List {
            Section {
                LabeledContent(L10n.aboutVersion, value: version)
                    .accessibilityIdentifier(AccessibilityIdentifier.aboutVersion)
                LabeledContent(L10n.aboutBuild, value: build)
            }
            .listRowBackground(rowBackground)

            if privacyPolicyURL != nil || termsURL != nil {
                Section {
                    if let privacyPolicyURL {
                        DocumentLink(title: L10n.accountPrivacyPolicy, url: privacyPolicyURL)
                    }
                    if let termsURL {
                        DocumentLink(title: L10n.accountTerms, url: termsURL)
                    }
                }
                .listRowBackground(rowBackground)
            }

            Section {
                ForEach(Credit.all) { credit in
                    VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
                        Text(credit.title)
                        Text(credit.licence)
                            .font(DesignTokens.Typography.caption)
                            .foregroundStyle(.white.opacity(0.6))
                    }
                    .padding(.vertical, 2)
                    .accessibilityElement(children: .combine)
                }
            } header: {
                SectionLabel(L10n.aboutCreditsSection)
            } footer: {
                // The MIT notice itself, verbatim rather than summarised:
                // summarising a licence is how a licence stops being one.
                Text(Credit.mitNotice)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.5))
            }
            .listRowBackground(rowBackground)
        }
        .scrollContentBackground(.hidden)
        .navigationTitle(L10n.aboutTitle)
        .sceneChrome()
    }

    private var rowBackground: some View {
        Rectangle().fill(.ultraThinMaterial)
    }
}

/// One body of work the app carries, and the terms it carries it under.
///
/// A list in code rather than a generated one: the app links four things,
/// they change about once a year, and a build-time generator would be more
/// machinery than the fact deserves. What it must never become is a list that
/// drifts from `Package.swift` — the licence names below are the ones the
/// packages themselves declare.
struct Credit: Identifiable {
    let id: String
    let title: String
    let licence: String

    static let all: [Credit] = [
        Credit(
            id: "flag-icons",
            title: "lipis/flag-icons",
            licence: "MIT · github.com/lipis/flag-icons"
        ),
        Credit(
            id: "natural-earth",
            title: "Natural Earth",
            licence: "Public domain · naturalearthdata.com"
        ),
        Credit(
            id: "swift-openapi",
            title: "apple/swift-openapi-generator, swift-openapi-runtime",
            licence: "Apache-2.0"
        ),
        Credit(
            id: "google-signin",
            title: "google/GoogleSignIn-iOS",
            licence: "Apache-2.0"
        ),
        Credit(
            id: "openfeature",
            title: "open-feature/swift-sdk",
            licence: "Apache-2.0"
        ),
    ]

    /// The MIT permission notice, which the licence requires to be shipped
    /// with the artwork rather than only referred to.
    static let mitNotice = """
        The flag artwork is used under the MIT licence: permission is hereby \
        granted, free of charge, to any person obtaining a copy of this \
        software and associated documentation files to deal in it without \
        restriction, subject to the copyright notice and this permission \
        notice being included. The software is provided "as is", without \
        warranty of any kind.
        """
}
