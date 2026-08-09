import Foundation

public enum DistractorFailure: Error, Equatable, Sendable {
    /// The deck does not contain four distinctly named countries, so a
    /// four-option question cannot be built without showing the same answer
    /// twice. The backend reports the same situation as 422 NO_DISTRACTORS.
    case notEnoughDistractors(learningCardID: UUID)
}

/// Builds the four options of an offline objective question.
///
/// The backend composes a session when there is a network. This is the offline
/// half, and it has to be deterministic: the same deck, the same card and the
/// same seed must produce the same four options in the same order, or a
/// relaunch would show the learner a different question than the one they were
/// answering.
public enum LocalDistractorSelection {
    public static let policyVersion = "local-deterministic-1"

    /// - Parameter seed: the session card's `randomSeed`. It is part of the
    ///   stored snapshot, so the ordering survives a relaunch.
    public static func options(
        for card: LearningCardRecord,
        from pool: [LearningCardRecord],
        seed: String,
        optionCount: Int = 4
    ) throws -> [StudyOptionRecord] {
        // Two countries whose localized names are identical must never appear
        // together: the learner would face two indistinguishable answers, and
        // one of them would be marked wrong.
        var seenNames: Set<String> = [normalized(card.displayName)]
        var distractors: [LearningCardRecord] = []

        for candidate in ranked(pool, excluding: card, seed: seed) {
            let name = normalized(candidate.displayName)
            guard seenNames.insert(name).inserted else { continue }
            distractors.append(candidate)
            if distractors.count == optionCount - 1 { break }
        }

        guard distractors.count == optionCount - 1 else {
            throw DistractorFailure.notEnoughDistractors(learningCardID: card.id)
        }

        // The answer's position is derived from the seed as well, so it is
        // stable across relaunches and not always the same slot.
        let answerPosition = abs(hash(seed + card.id.uuidString)) % optionCount
        var names: [String] = distractors.map(\.displayName)
        names.insert(card.displayName, at: answerPosition)

        return names.enumerated().map { position, name in
            StudyOptionRecord(
                // The identifier is derived from the session's seed and the
                // slot, so a replay rebuilds the same option identities rather
                // than minting new ones that would not match a stored review.
                id: deterministicID(seed: seed, cardID: card.id, position: position),
                position: position,
                displayName: name
            )
        }
    }

    /// Which option is the answer, for a session this device composed.
    public static func correctOptionID(
        in options: [StudyOptionRecord],
        answer displayName: String
    ) -> UUID? {
        options.first { $0.displayName == displayName }?.id
    }

    /// Candidates ordered by a value derived from the seed, so the choice looks
    /// arbitrary to the learner and is reproducible for the device.
    private static func ranked(
        _ pool: [LearningCardRecord],
        excluding card: LearningCardRecord,
        seed: String
    ) -> [LearningCardRecord] {
        pool
            .filter { $0.id != card.id && !$0.isRetired && !$0.displayName.isEmpty }
            .sorted { left, right in
                let leftKey = hash(seed + left.id.uuidString)
                let rightKey = hash(seed + right.id.uuidString)
                if leftKey != rightKey { return leftKey < rightKey }
                return left.id.uuidString < right.id.uuidString
            }
    }

    private static func normalized(_ value: String) -> String {
        value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// A small stable hash.
    ///
    /// `Hasher` is seeded per process and would order the options differently
    /// on every launch, which is exactly what this must not do.
    static func hash(_ value: String) -> Int {
        var result = 5381
        for byte in value.utf8 {
            result = (result &* 33) &+ Int(byte)
        }
        return result
    }

    private static func deterministicID(seed: String, cardID: UUID, position: Int) -> UUID {
        let source = "\(seed)|\(cardID.uuidString)|\(position)"
        var bytes = [UInt8](repeating: 0, count: 16)
        var accumulator = hash(source)
        for index in 0..<16 {
            bytes[index] = UInt8(truncatingIfNeeded: accumulator)
            accumulator = (accumulator &* 33) &+ Int(index &+ 1)
        }
        // Version 4, variant 1, so the value is a well-formed UUID rather than
        // sixteen arbitrary bytes.
        bytes[6] = (bytes[6] & 0x0F) | 0x40
        bytes[8] = (bytes[8] & 0x3F) | 0x80
        return UUID(uuid: (
            bytes[0], bytes[1], bytes[2], bytes[3],
            bytes[4], bytes[5], bytes[6], bytes[7],
            bytes[8], bytes[9], bytes[10], bytes[11],
            bytes[12], bytes[13], bytes[14], bytes[15]
        ))
    }
}
