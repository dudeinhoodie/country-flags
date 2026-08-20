import Compression
import CryptoKit
import Foundation

/// Wraps the platform's raw DEFLATE in gzip framing.
///
/// The contract asks for `gzip_base64` and the backend recomputes the digest of
/// what it decodes, so "close enough" is not an option: `Data.compressed(using:
/// .zlib)` produces a bare DEFLATE stream, and gzip is that stream between a
/// ten-byte header and an eight-byte trailer carrying the CRC and the original
/// size. Producing real gzip here means anything downstream — a script, a
/// browser, `gunzip` — can read what was uploaded.
enum GzipEncoder {
    static func encode(_ data: Data) -> Data? {
        guard !data.isEmpty else { return nil }
        guard let deflated = try? (data as NSData).compressed(using: .zlib) as Data else {
            return nil
        }

        var framed = Data([
            0x1F, 0x8B,  // magic
            0x08,  // DEFLATE
            0x00,  // no flags: no name, no comment, no extra field
            0x00, 0x00, 0x00, 0x00,  // modification time: deliberately zero
            0x00,  // no extra compression hints
            0xFF,  // unknown platform, which is the honest answer here
        ])
        framed.append(deflated)

        var crc = CRC32.checksum(of: data).littleEndian
        withUnsafeBytes(of: &crc) { framed.append(contentsOf: $0) }
        var size = UInt32(truncatingIfNeeded: data.count).littleEndian
        withUnsafeBytes(of: &size) { framed.append(contentsOf: $0) }
        return framed
    }
}

/// The checksum gzip's trailer carries.
///
/// Written out rather than pulled in: it is twenty lines, and a dependency for
/// twenty lines is a dependency to update, audit and explain.
enum CRC32 {
    private static let table: [UInt32] = (0...255).map { index -> UInt32 in
        var value = UInt32(index)
        for _ in 0..<8 {
            value = (value & 1) == 1 ? (0xEDB8_8320 ^ (value >> 1)) : (value >> 1)
        }
        return value
    }

    static func checksum(of data: Data) -> UInt32 {
        var crc: UInt32 = 0xFFFF_FFFF
        for byte in data {
            crc = table[Int((crc ^ UInt32(byte)) & 0xFF)] ^ (crc >> 8)
        }
        return crc ^ 0xFFFF_FFFF
    }
}

/// The digest the backend recomputes over the compressed bytes.
enum SHA256Digest {
    static func hexDigest(of data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
