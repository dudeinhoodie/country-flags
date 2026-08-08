import Foundation

import CountryFlagsDomain

extension APIError {
    /// What a screen may show.
    ///
    /// The server message is deliberately dropped. An error envelope is written
    /// for whoever reads the backend logs: it can name an internal rule, a
    /// provider or a record, and none of that belongs on a person's screen. The
    /// kind selects copy the app owns; the request identifier is the one thing
    /// worth carrying across, because support cannot find anything without it.
    public var presentable: PresentableError {
        PresentableError(
            kind: presentableKind,
            code: details?.code,
            supportRequestID: supportRequestID
        )
    }

    private var presentableKind: PresentableError.Kind {
        switch self {
        case .unauthorized: .unauthorized
        case .forbidden:
            // A disabled feature is a forbidden call with a registered code, and
            // it deserves its own message: nothing is wrong with the account.
            details?.code == "FEATURE_DISABLED" ? .featureDisabled : .forbidden
        case .notFound: .notFound
        case .conflict: .conflict
        case .validationFailed: .invalidInput
        case .rateLimited: .rateLimited
        case .server: .server
        case .client: .unexpected
        case .transport(let code):
            // The URLError codes that mean "the device is not online" rather
            // than "the request failed".
            Self.offlineTransportCodes.contains(code) ? .offline : .timeout
        case .decoding: .unexpected
        case .cancelled: .unexpected
        }
    }

    private static let offlineTransportCodes: Set<String> = [
        String(URLError.notConnectedToInternet.rawValue),
        String(URLError.networkConnectionLost.rawValue),
        String(URLError.dataNotAllowed.rawValue),
        String(URLError.internationalRoamingOff.rawValue),
    ]
}
