import Foundation

/// Removes what must never be logged, reported or exported.
///
/// The rules run on the device before anything leaves it. Scrubbing on a
/// provider's side is a second layer, not the only one: by the time a payload
/// reaches a provider the secret has already been transmitted.
public enum Redaction {
    public static let placeholder = "[redacted]"

    /// Field names whose value is dropped whatever it holds. Matching is done
    /// on a normalized name, so `X-Auth-Token`, `authToken` and `auth_token`
    /// are the same name.
    public static let deniedFieldNames: Set<String> = [
        "authorization",
        "accesstoken",
        "refreshtoken",
        "identitytoken",
        "idtoken",
        "authtoken",
        "bearer",
        "cookie",
        "setcookie",
        "password",
        "secret",
        "apikey",
        "clientsecret",
        "email",
        "emailaddress",
        "providersubject",
        "subject",
        "pushtoken",
        "devicetoken",
        "latitude",
        "longitude",
        "answertext",
        "requestbody",
        "responsebody",
    ]

    /// Fragments that condemn a name however it is spelled or prefixed.
    ///
    /// An exact list cannot keep up with `X-Auth-Token`, `sessionToken` and
    /// whatever the next header is called, and a name nobody has thought of yet
    /// is exactly the case redaction exists for.
    public static let deniedFieldNameFragments: [String] = [
        "token",
        "authorization",
        "password",
        "secret",
        "apikey",
        "credential",
        "email",
        "cookie",
    ]

    public static func isDenied(fieldName: String) -> Bool {
        let name = normalized(fieldName)
        if deniedFieldNames.contains(name) { return true }
        return deniedFieldNameFragments.contains { name.contains($0) }
    }

    /// Replaces denied fields and redacts what is left, so a value that carries
    /// a token under an innocent name is caught as well.
    public static func redact(fields: [String: String]) -> [String: String] {
        var result: [String: String] = [:]
        result.reserveCapacity(fields.count)
        for (name, value) in fields {
            result[name] = isDenied(fieldName: name) ? placeholder : redact(value)
        }
        return result
    }

    /// Masks the shapes a secret takes in free text: a JWT, an `Authorization`
    /// header, a bearer token and an email address.
    public static func redact(_ text: String) -> String {
        var result = text
        for pattern in patterns {
            result = pattern.stringByReplacingMatches(
                in: result,
                range: NSRange(result.startIndex..., in: result),
                withTemplate: placeholder
            )
        }
        return result
    }

    private static func normalized(_ name: String) -> String {
        name.lowercased().filter { $0.isLetter || $0.isNumber }
    }

    /// Compiled once: a redaction runs on every log line and error report.
    private static let patterns: [NSRegularExpression] = [
        // A JWT, which is how every identity and access token in this project
        // looks.
        #"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?"#,
        // An Authorization header value, with or without its name.
        #"(?i)\b(?:authorization\s*[:=]\s*)?(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+"#,
        // An email address.
        #"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"#,
    ].compactMap { try? NSRegularExpression(pattern: $0) }
}
