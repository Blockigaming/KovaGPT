import ActivityKit
import Foundation

@available(iOS 16.1, *)
struct KovaVoiceActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var phase: String

        var label: String {
            switch phase {
            case "recording": return "Listening"
            case "speaking": return "Speaking"
            case "stopping", "transcribing": return "Transcribing"
            case "chat", "synthesizing": return "Preparing reply"
            case "foreground-required": return "Open KovaGPT to continue"
            default: return "Voice ready"
            }
        }
    }
    var sessionID: UUID
}
