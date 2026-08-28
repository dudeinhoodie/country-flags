import Foundation
import SwiftUI

import CountryFlagsDomain

/// How a fact is worded on screen, wherever it appears.
///
/// The release publishes each fact twice over: as parts, and as a line the
/// backend composed from them. Every surface that shows facts — the card's
/// back in either session, and the country sheet — passes them through here,
/// so the wording cannot drift between them.
///
/// The parts are what this reads. The composed line bakes in decisions that
/// belong to the screen — whether a currency shows the code printed on the
/// note, where the year of a count goes — and the client used to undo them
/// with regular expressions, which is a guess about how the sentence was
/// built. When a fact arrives without parts, from a release whose stored
/// shape the backend does not model, the line is shown exactly as it came.
enum FactDisplay {
    /// The label and the value, tidied.
    ///
    /// The year of a count is provenance, not part of the number: it belongs
    /// in the label — "Population 2024" — where it reads as a caption rather
    /// than as a code. A population is then compacted to the two or three
    /// digits a person actually keeps: nobody remembers 8,406,558, everybody
    /// remembers 8.4M.
    static func presentation(for fact: FactRecord) -> (label: String?, value: String) {
        let label = L10n.factType(fact.type)

        switch fact.details {
        case .population(let count, let year):
            return (
                year.map { "\(label ?? "") \($0)" } ?? label,
                compactNumber(count)
            )
        case .currency(let tenders):
            // The name alone: the ISO code is catalogue data, and a reader
            // learning a country is not learning that the krone is NOK.
            return (label, join(tenders.map(\.name)))
        case .capital(let seats):
            return (label, join(seats.map(\.name)))
        case .language(let languages):
            return (label, join(languages.map(\.name)))
        case .none:
            return (label, fact.displayValue)
        }
    }

    /// The separator the backend used, kept so a fact with parts and one
    /// without read the same in a list.
    private static func join(_ values: [String]) -> String {
        values.joined(separator: ", ")
    }

    /// 8_406_558 → "8.4M".
    ///
    /// The suffixes are the classical K / M / B, not localised: they are the
    /// notation of the number itself, like the digits. Below ten the first
    /// decimal still matters — 1.4M and 1M are different countries — and from
    /// ten up it is noise. Below a thousand the number is short enough to
    /// read as it is, grouped for the reader's locale.
    static func compactNumber(_ count: Int) -> String {
        let value = Double(count)
        let tiers: [(threshold: Double, suffix: String)] = [
            (1_000_000_000, "B"),
            (1_000_000, "M"),
            (1_000, "K"),
        ]
        guard let tier = tiers.first(where: { value >= $0.threshold }) else {
            return count.formatted(.number)
        }

        let scaled = value / tier.threshold
        let rounded = (scaled * 10).rounded() / 10
        if rounded >= 10 || rounded == rounded.rounded() {
            return "\(Int(rounded.rounded()))\(tier.suffix)"
        }
        return "\(rounded)\(tier.suffix)"
    }
}
