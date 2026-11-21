import Foundation

enum KovaDestination: String, CaseIterable {
    case chat, voice, images, tasks

    static let origin = URL(string: "https://kovagpt.com")!

    var url: URL {
        switch self {
        case .chat: Self.origin.appending(path: "/")
        case .voice: URL(string: "https://kovagpt.com/?native_voice=1")!
        case .images: Self.origin.appending(path: "images")
        case .tasks: Self.origin.appending(path: "scheduled-tasks")
        }
    }

    var shortcutURL: URL { URL(string: "kovagpt-native://open/\(rawValue)")! }

    init?(shortcutURL: URL) {
        guard shortcutURL.scheme == "kovagpt-native", shortcutURL.host == "open",
              shortcutURL.port == nil, shortcutURL.user == nil, shortcutURL.password == nil,
              shortcutURL.query == nil, shortcutURL.fragment == nil,
              let path = URLComponents(url: shortcutURL, resolvingAgainstBaseURL: false)?.percentEncodedPath,
              let destination = Self.allCases.first(where: { path == "/" + $0.rawValue }) else { return nil }
        self = destination
    }

    static func isTrusted(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme == "https" && url.host == "kovagpt.com" &&
            url.user == nil && url.password == nil && (url.port == nil || url.port == 443)
    }
}
