import LocalAuthentication
import SwiftUI

@MainActor
final class KovaLaunch: ObservableObject {
    static let shared = KovaLaunch()
    struct Request {
        let id = UUID()
        let destination: KovaDestination
        var exchangeURL: URL? = nil
    }
    @Published private(set) var request = Request(destination: .chat)

    func completeGoogleSignIn(_ callback: URL) {
        guard var parts = URLComponents(url: callback, resolvingAgainstBaseURL: false),
              parts.scheme == "kovagpt-native", parts.host == "google",
              parts.user == nil, parts.password == nil, parts.port == nil,
              parts.fragment == nil, parts.percentEncodedPath == "/exchange",
              let query = parts.queryItems, query.count == 2,
              Set(query.map(\.name)) == ["handoff", "binding"],
              query.allSatisfy({ ($0.value?.utf8.count ?? 0) > 0 && ($0.value?.utf8.count ?? 0) <= 4096 })
        else { return }
        parts.scheme = "https"
        parts.host = "kovagpt.com"
        parts.path = "/api/auth/google/exchange"
        guard let url = parts.url else { return }
        request = Request(destination: .chat, exchangeURL: url)
    }

    func open(_ destination: KovaDestination) {
        request = Request(destination: destination)
    }
}

@main
struct KovaChatApp: App {
    @StateObject private var launch = KovaLaunch.shared

    var body: some Scene {
        WindowGroup {
            KovaChatWindow(request: launch.request)
                .onOpenURL { url in
                    if let destination = KovaDestination(shortcutURL: url) { launch.open(destination) }
                    else { launch.completeGoogleSignIn(url) }
                }
        }
    }
}

private struct KovaChatWindow: View {
    let request: KovaLaunch.Request
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("kova.device-lock") private var lockEnabled = false
    @State private var unlocked = !UserDefaults.standard.bool(forKey: "kova.device-lock")
    @State private var verifying = false
    @State private var error: String?

    var body: some View {
        ZStack {
            KovaChatWebView(request: request, unlocked: unlocked, changeLock: changeLock)
                .accessibilityHidden(!unlocked)
                .opacity(unlocked && scenePhase == .active ? 1 : 0)
            if !unlocked && scenePhase == .active {
                VStack(spacing: 20) {
                    Image(systemName: "lock").font(.largeTitle).accessibilityHidden(true)
                    Text("KovaGPT is locked").font(.title2.weight(.semibold))
                    Button("Unlock KovaGPT") { verify(enabling: false) }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .disabled(verifying)
                    if let error { Text(error).font(.callout) }
                }
                .padding(24)
            }
        }
        .background(Color(uiColor: .systemBackground).ignoresSafeArea())
        .onChange(of: scenePhase) { _, phase in
            if phase == .background && lockEnabled { unlocked = false }
        }
        .alert("Device lock", isPresented: Binding(
            get: { unlocked && error != nil },
            set: { if !$0 { error = nil } }
        )) {
            Button("OK", role: .cancel) { error = nil }
        } message: {
            Text(error ?? "")
        }
    }

    private func changeLock() {
        let context = LAContext()
        var failure: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &failure) else {
            error = "Set up a device passcode in Settings to use device lock."
            return
        }
        verify(enabling: !lockEnabled, context: context, changingPreference: true)
    }

    private func verify(enabling: Bool, context: LAContext = LAContext(), changingPreference: Bool = false) {
        guard !verifying else { return }
        verifying = true
        error = nil
        Task { @MainActor in
            defer { verifying = false }
            do {
                let reason = changingPreference ? "Change the KovaGPT device lock" : "Unlock KovaGPT"
                guard try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) else { return }
                if changingPreference { lockEnabled = enabling }
                unlocked = true
            } catch {
                self.error = "Device authentication did not finish. Try again."
            }
        }
    }
}
