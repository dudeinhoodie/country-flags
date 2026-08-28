import Foundation

import CountryFlagsDomain

/// How a fact's parts are put into the store and taken back out.
///
/// JSON, in one column, because nothing queries a fact by its capital or its
/// currency code — facts are read whole, with the card they sit behind.
///
/// Neither direction throws. A fact whose parts cannot be encoded is stored
/// without them and a stored blob that cannot be read is treated as absent,
/// which lands the reader on the line the backend composed. That is the same
/// place a release published before this shape puts them, so the failure has
/// a screen already: it is never an empty card.
enum FactDetailsCoding {
    static func encode(_ details: FactDetails?) -> Data? {
        guard let details else { return nil }
        return try? JSONEncoder().encode(details)
    }

    static func decode(_ data: Data?) -> FactDetails? {
        guard let data else { return nil }
        return try? JSONDecoder().decode(FactDetails.self, from: data)
    }
}
