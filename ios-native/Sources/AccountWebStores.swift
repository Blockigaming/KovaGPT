import Foundation
import WebKit

/// Only profile identifiers are stored in native preferences; sessions stay inside WebKit.
@MainActor
enum AccountWebStores {
    static func store(for slot: Int, defaults: UserDefaults = .standard) -> WKWebsiteDataStore? {
        if slot == 1 { return .default() }
        guard slot == 2 else { return nil }
        guard #available(iOS 17.0, *) else { return nil }
        return WKWebsiteDataStore(forIdentifier: secondIdentifier(defaults: defaults))
    }

    static func secondIdentifier(defaults: UserDefaults = .standard) -> UUID {
        let key = "KovaGPTSecondAccountStore"
        if let saved = defaults.string(forKey: key), let identifier = UUID(uuidString: saved) {
            return identifier
        }
        let identifier = UUID()
        defaults.set(identifier.uuidString, forKey: key)
        return identifier
    }
}
