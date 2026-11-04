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

    /// 8_406_558 → "8.4M", or "8,4 млн" in Russian (#525).
    ///
    /// In English the suffixes are the classical K / M / B. In Russian they
    /// are the words a Russian reader writes — "тыс.", "млн", "млрд" — after a
    /// space, with the decimal comma: "8.4M" in a Russian sentence read as a
    /// code. Below ten the first decimal still matters — 1.4M and 1M are
    /// different countries — and from ten up it is noise. Below a thousand the
    /// number is short enough to read as it is, grouped for the reader's
    /// locale.
    static func compactNumber(_ count: Int, language: String = L10n.appLanguage) -> String {
        let isRussian = language.hasPrefix("ru")
        let value = Double(count)
        let tiers: [(threshold: Double, suffix: String)] = isRussian
            ? [(1_000_000_000, "\u{00A0}млрд"), (1_000_000, "\u{00A0}млн"), (1_000, "\u{00A0}тыс.")]
            : [(1_000_000_000, "B"), (1_000_000, "M"), (1_000, "K")]
        guard let tier = tiers.first(where: { value >= $0.threshold }) else {
            return count.formatted(.number)
        }

        let scaled = value / tier.threshold
        let rounded = (scaled * 10).rounded() / 10
        if rounded >= 10 || rounded == rounded.rounded() {
            return "\(Int(rounded.rounded()))\(tier.suffix)"
        }
        let decimal = isRussian
            ? "\(rounded)".replacingOccurrences(of: ".", with: ",")
            : "\(rounded)"
        return "\(decimal)\(tier.suffix)"
    }
}

/// One fact, the same everywhere (#525): its badge, its label, its value.
///
/// The back of a card, the quiz's answer and the country sheet each drew
/// facts their own way — a grey label beside a grey value, a row with a
/// badge, a tile in a grid. The 2026-11-03 review asked for one row, and the
/// owner kept it: the badge is what lets the eye land on "population"
/// without reading.
struct FactRow: View {
    let symbol: String
    let color: Color
    let label: String?
    let value: String

    var body: some View {
        HStack(spacing: DesignTokens.Spacing.small) {
            SymbolBadge(symbol: symbol, color: color)
            VStack(alignment: .leading, spacing: 0) {
                if let label {
                    Text(label)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.6))
                }
                Text(value)
                    .font(DesignTokens.Typography.body.weight(.medium))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
            }
            Spacer(minLength: 0)
        }
        // One row is one thing to hear, not a label and a value in sequence —
        // and combining them is also what lets the row carry an identifier
        // without handing it to both.
        .accessibilityElement(children: .combine)
    }
}

extension FactRow {
    /// A release fact, worded by `FactDisplay`.
    init(fact: FactRecord) {
        let presentation = FactDisplay.presentation(for: fact)
        self.init(
            symbol: FactBadge.symbol(for: fact.type),
            color: FactBadge.color(for: fact.type),
            label: presentation.label,
            value: presentation.value
        )
    }
}
