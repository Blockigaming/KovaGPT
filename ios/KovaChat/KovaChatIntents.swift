import AppIntents

struct OpenKovaVoice: AppIntent {
    static let title: LocalizedStringResource = "Open Kova Voice"
    static let description = IntentDescription("Open the KovaGPT voice controls.")
    static let openAppWhenRun = true

    @MainActor func perform() async throws -> some IntentResult {
        KovaLaunch.shared.open(.voice)
        return .result()
    }
}

struct OpenKovaChat: AppIntent {
    static let title: LocalizedStringResource = "Open Kova Chat"
    static let openAppWhenRun = true

    @MainActor func perform() async throws -> some IntentResult {
        KovaLaunch.shared.open(.chat)
        return .result()
    }
}

struct KovaChatShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: OpenKovaVoice(),
            phrases: ["Open voice in \(.applicationName)", "Talk to \(.applicationName)"],
            shortTitle: "Open Kova Voice", systemImageName: "waveform"
        )
        AppShortcut(
            intent: OpenKovaChat(),
            phrases: ["Open chat in \(.applicationName)"],
            shortTitle: "Open Kova Chat", systemImageName: "bubble.left"
        )
    }
}
