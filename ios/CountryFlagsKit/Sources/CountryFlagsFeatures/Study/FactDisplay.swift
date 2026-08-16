import Foundation
import SwiftUI

import CountryFlagsDomain

/// How a fact is worded on screen, wherever it appears.
///
/// The release publishes facts for reading by a machine as much as by a
/// person: a population arrives as "8,406,558 (2024)". Both surfaces that
/// show facts — the card's back and the country sheet — pass them through
/// here, so the wording cannot drift between them.
enum FactDisplay {
    /// The label and the value, tidied.
    ///
    /// The trailing year is provenance, not part of the number: it moves out
    /// of the value and into the label — "Population 2024" — where it reads
    /// as a caption rather than as a code. A population is then compacted to
    /// the two or three digits a person actually keeps: nobody remembers
    /// 8,406,558, everybody remembers 8.4M.
    static func presentation(for fact: FactRecord) -> (label: String?, value: String) {
        var label = L10n.factType(fact.type)
        var value = fact.displayValue

        if label != nil,
            let match = value.range(of: #" \((\d{4})\)$"#, options: .regularExpression) {
            let year = value[match].dropFirst(2).dropLast(1)
            label = "\(label ?? "") \(year)"
            value = String(value[..<match.lowerBound])
        }

        if fact.type.uppercased() == "POPULATION" {
            value = compactNumber(value)
        }

        if fact.type.uppercased() == "CURRENCY" {
            value = strippingCurrencyCodes(value)
        }

        return (label, value)
    }

    /// "Norwegian Krone (NOK)" → "Norwegian Krone".
    ///
    /// The backend joins the name and the ISO code into one string; the code
    /// is catalogue data, not reading matter, and the screens show the name
    /// alone. The backlog asks the contract to publish the fact structured so
    /// this regex can retire.
    static func strippingCurrencyCodes(_ value: String) -> String {
        var text = value
        while let match = text.range(of: #" \([A-Z]{3}\)"#, options: .regularExpression) {
            text.removeSubrange(match)
        }
        return text
    }

    /// "8,406,558" → "8.4M", whatever the thousands separator was.
    ///
    /// The suffixes are the classical K / M / B, not localised: they are the
    /// notation of the number itself, like the digits. Below ten the first
    /// decimal still matters — 1.4M and 1M are different countries — and
    /// from ten up it is noise. A value that is not purely a number is
    /// returned untouched rather than half-formatted.
    static func compactNumber(_ raw: String) -> String {
        let digits = raw.filter(\.isNumber)
        guard digits == raw.filter({ !$0.isWhitespace && $0 != "," && $0 != "." }),
            let value = Double(digits), value >= 1000
        else {
            return raw
        }

        let tiers: [(threshold: Double, suffix: String)] = [
            (1_000_000_000, "B"),
            (1_000_000, "M"),
            (1_000, "K"),
        ]
        guard let tier = tiers.first(where: { value >= $0.threshold }) else { return raw }

        let scaled = value / tier.threshold
        let rounded = (scaled * 10).rounded() / 10
        if rounded >= 10 || rounded == rounded.rounded() {
            return "\(Int(rounded.rounded()))\(tier.suffix)"
        }
        return "\(rounded)\(tier.suffix)"
    }
}
