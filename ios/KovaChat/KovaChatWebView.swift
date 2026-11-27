import AuthenticationServices
import CarPlay
import AVFoundation
import SwiftUI
import WebKit

struct KovaChatWebView: UIViewRepresentable {
    let request: KovaLaunch.Request
    let unlocked: Bool
    let changeLock: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(changeLock: changeLock) }

    func makeUIView(context: Context) -> WKWebView { Self.makeWebView(coordinator: context.coordinator) }

    static func makeWebView(coordinator: Coordinator) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.applicationNameForUserAgent = coordinator.carPlay ? "KovaGPTNative/CarPlay" : "KovaGPTNative/iOS"
        configuration.userContentController.add(coordinator, name: "kovaNative")
        configuration.userContentController.addScriptMessageHandler(
            coordinator, contentWorld: .page, name: "kovaReadAloud"
        )
        configuration.userContentController.addScriptMessageHandler(
            coordinator, contentWorld: .page, name: "kovaDictation"
        )
        let web = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: configuration)
        web.navigationDelegate = coordinator
        web.uiDelegate = coordinator
        web.allowsBackForwardNavigationGestures = true
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.isOpaque = false
        coordinator.web = web
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        let coordinator = context.coordinator
        coordinator.changeLock = changeLock
        if !unlocked && coordinator.unlocked {
            coordinator.cancelDictation()
            coordinator.endBackgroundReply()
            coordinator.stopReading(notifyPage: true)
            coordinator.signal("kova-native-audio-interruption")
        }
        coordinator.unlocked = unlocked
        guard unlocked, coordinator.request != request.id else { return }
        coordinator.request = request.id
        if request.destination == .voice, KovaDestination.isTrusted(web.url), web.url?.path == "/" {
            coordinator.signal("kova-native-open-voice")
        } else {
            web.load(URLRequest(url: request.exchangeURL ?? request.destination.url))
        }
    }

    static func dismantleUIView(_ web: WKWebView, coordinator: Coordinator) {
        web.configuration.userContentController.removeScriptMessageHandler(forName: "kovaNative")
        web.configuration.userContentController.removeScriptMessageHandler(forName: "kovaReadAloud", contentWorld: .page)
        web.configuration.userContentController.removeScriptMessageHandler(forName: "kovaDictation", contentWorld: .page)
        coordinator.stop()
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler,
        WKScriptMessageHandlerWithReply, AVAudioPlayerDelegate, AVAudioRecorderDelegate, ASWebAuthenticationPresentationContextProviding {
        var request: UUID?
        var unlocked = false
        var carPlay = false
        var onCarPlayState: ((String) -> Void)?
        var changeLock: () -> Void
        weak var web: WKWebView?
        private var textSizeObserver: NSObjectProtocol?
        private var audioObservers: [NSObjectProtocol] = []
        private var dictation: AVAudioRecorder?
        private var dictationID: String?
        private var dictationTimer: Timer?
        private var speechBegan: TimeInterval?
        private var lastSpeech: TimeInterval?
        private var heardSpeech = false
        private var dictationMuted = false
        private var reader: AVAudioPlayer?
        private var readingID: String?
        private var readingAllowsContinuation = false
        private var continuationDeadline: TimeInterval = 0
        private var recordedReplyID: String?
        private var backgroundReply: UIBackgroundTaskIdentifier = .invalid
        private var backgroundReplyID: String?
        private var googleSession: ASWebAuthenticationSession?
        private var googleSessionID: UUID?

        init(changeLock: @escaping () -> Void) {
            self.changeLock = changeLock
            super.init()
            let center = NotificationCenter.default
            textSizeObserver = center.addObserver(
                forName: UIContentSizeCategory.didChangeNotification, object: nil, queue: .main
            ) { [weak self] _ in
                Task { @MainActor in self?.applyDynamicType() }
            }
            audioObservers.append(center.addObserver(
                forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
            ) { [weak self] notification in
                guard notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt ==
                    AVAudioSession.InterruptionType.began.rawValue else { return }
                Task { @MainActor in
                    self?.cancelDictation()
                    self?.stopReading(notifyPage: true)
                    self?.signal("kova-native-audio-interruption")
                    self?.onCarPlayState?("ended")
                }
            })
            audioObservers.append(center.addObserver(
                forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
            ) { [weak self] notification in
                guard notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ==
                    AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue else { return }
                Task { @MainActor in
                    self?.cancelDictation()
                    self?.stopReading(notifyPage: true)
                    self?.signal("kova-native-audio-interruption")
                    self?.onCarPlayState?("ended")
                }
            })
        }

        func stop() {
            if let textSizeObserver { NotificationCenter.default.removeObserver(textSizeObserver) }
            textSizeObserver = nil
            googleSessionID = nil
            googleSession?.cancel()
            googleSession = nil
            cancelDictation()
            endBackgroundReply()
            stopReading()
            for observer in audioObservers { NotificationCenter.default.removeObserver(observer) }
            audioObservers.removeAll()
        }

        func endBackgroundReply() {
            let task = backgroundReply
            backgroundReply = .invalid
            backgroundReplyID = nil
            recordedReplyID = nil
            continuationDeadline = 0
            if task != .invalid { UIApplication.shared.endBackgroundTask(task) }
        }

        @discardableResult
        private func beginBackgroundReply(_ id: String, completingNativeRecording: Bool = false) -> Bool {
            guard (completingNativeRecording || UIApplication.shared.applicationState == .active),
                  UUID(uuidString: id) != nil else { return false }
            endBackgroundReply()
            let task = UIApplication.shared.beginBackgroundTask(withName: "Kova voice reply") {
                [weak self] in
                Task { @MainActor in
                    guard let self, self.backgroundReplyID == id else { return }
                    self.endBackgroundReply()
                    self.signal("kova-native-audio-interruption")
                    self.onCarPlayState?("ended")
                }
            }
            guard task != .invalid else { return false }
            backgroundReply = task
            backgroundReplyID = id
            if completingNativeRecording { recordedReplyID = id }
            return true
        }

        func signal(_ event: String) {
            guard let web, KovaDestination.isTrusted(web.url) else { return }
            web.callAsyncJavaScript(
                "if (location.origin === 'https://kovagpt.com') window.dispatchEvent(new Event(name));",
                arguments: ["name": event], in: nil, in: .page
            )
        }

        func stopReading(notifyPage: Bool = false) {
            guard let current = reader else { return }
            let id = readingID
            readingID = nil
            readingAllowsContinuation = false
            reader = nil
            current.delegate = nil
            current.stop()
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            if notifyPage, let id { readingFinished(id, success: false) }
        }

        private func readingFinished(_ id: String, success: Bool) {
            guard let web, KovaDestination.isTrusted(web.url) else { return }
            web.callAsyncJavaScript(
                """
                if (location.origin === 'https://kovagpt.com') {
                    window.dispatchEvent(new CustomEvent('kova-native-read-aloud', { detail: {id, success} }));
                }
                """,
                arguments: ["id": id, "success": success], in: nil, in: .page
            )
        }

        nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
            completeReading(ObjectIdentifier(player), success: flag)
        }

        nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
            completeReading(ObjectIdentifier(player), success: false)
        }

        private nonisolated func completeReading(_ playerID: ObjectIdentifier, success: Bool) {
            Task { @MainActor in
                guard let reader, ObjectIdentifier(reader) == playerID, let readingID else { return }
                let shouldContinue = success && readingAllowsContinuation &&
                    UIApplication.shared.applicationState == .background && unlocked
                if shouldContinue && beginBackgroundReply(readingID, completingNativeRecording: true) {
                    continuationDeadline = ProcessInfo.processInfo.systemUptime + 3
                }
                stopReading()
                readingFinished(readingID, success: success)
            }
        }

        private func applyDynamicType() {
            guard let web, KovaDestination.isTrusted(web.url) else { return }
            let size = UIFontMetrics(forTextStyle: .body).scaledValue(for: 16)
            web.callAsyncJavaScript(
                """
                if (location.origin === 'https://kovagpt.com') {
                    document.documentElement.style.setProperty('--kova-native-font-size', size + 'px');
                }
                """,
                arguments: ["size": Double(size)], in: nil, in: .page
            )
        }

        func webView(_ web: WKWebView, didFinish navigation: WKNavigation!) {
            applyDynamicType()
        }

        func webView(_ web: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            cancelDictation()
            endBackgroundReply()
            stopReading()
        }

        func cancelDictation() {
            dictationID = nil
            dictationTimer?.invalidate()
            dictationTimer = nil
            speechBegan = nil
            lastSpeech = nil
            heardSpeech = false
            dictationMuted = false
            guard let recorder = dictation else { return }
            dictation = nil
            recorder.delegate = nil
            recorder.stop()
            try? FileManager.default.removeItem(at: recorder.url)
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }

        private func startDictation(_ id: String, handsFree: Bool, reply: @escaping (Any?, String?) -> Void) {
            guard unlocked, dictationID == nil else { reply(false, nil); return }
            if carPlay || UIApplication.shared.applicationState == .background {
                guard handsFree,
                      (carPlay || ProcessInfo.processInfo.systemUptime < continuationDeadline),
                      (!carPlay || !UserDefaults.standard.bool(forKey: "kova.device-lock")),
                      AVAudioApplication.shared.recordPermission == .granted else {
                    reply(false, nil)
                    return
                }
                continuationDeadline = 0
                dictationID = id
                let started = startRecorder(id, handsFree: true)
                endBackgroundReply()
                reply(started, nil)
                return
            }
            guard UIApplication.shared.applicationState == .active else { reply(false, nil); return }
            dictationID = id
            AVAudioApplication.requestRecordPermission { [weak self] granted in
                Task { @MainActor in
                    guard let self, self.dictationID == id else { reply(false, nil); return }
                    guard granted, self.unlocked, UIApplication.shared.applicationState == .active else {
                        self.cancelDictation()
                        reply(false, nil)
                        return
                    }
                    reply(self.startRecorder(id, handsFree: handsFree), nil)
                }
            }
        }

        private func startRecorder(_ id: String, handsFree: Bool) -> Bool {
            stopReading(notifyPage: true)
            let audio = AVAudioSession.sharedInstance()
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString).appendingPathExtension("wav")
            do {
                try audio.setCategory(.playAndRecord, mode: handsFree ? .voiceChat : .default, options: .defaultToSpeaker)
                try audio.setActive(true)
                let recorder = try AVAudioRecorder(url: url, settings: [
                    AVFormatIDKey: kAudioFormatLinearPCM,
                    AVSampleRateKey: 16000,
                    AVNumberOfChannelsKey: 1,
                    AVLinearPCMBitDepthKey: 16,
                    AVLinearPCMIsBigEndianKey: false,
                    AVLinearPCMIsFloatKey: false
                ])
                dictation = recorder
                recorder.delegate = self
                guard recorder.record(forDuration: 59) else { cancelDictation(); return false }
                if handsFree {
                    recorder.isMeteringEnabled = true
                    startVoiceMeter(id)
                }
                onCarPlayState?("listening")
                return true
            } catch {
                cancelDictation()
                try? FileManager.default.removeItem(at: url)
                try? audio.setActive(false, options: .notifyOthersOnDeactivation)
                return false
            }
        }

        private func startVoiceMeter(_ id: String) {
            let deadline = ProcessInfo.processInfo.systemUptime + 59
            dictationTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) {
                [weak self] _ in
                Task { @MainActor in self?.checkVoiceMeter(id, deadline: deadline) }
            }
        }

        private func checkVoiceMeter(_ id: String, deadline: TimeInterval) {
            guard dictationID == id, let recorder = dictation else { return }
            let now = ProcessInfo.processInfo.systemUptime
            if now >= deadline {
                recorder.stop()
                return
            }
            guard recorder.isRecording, !dictationMuted else { return }
            recorder.updateMeters()
            if recorder.averagePower(forChannel: 0) >= -35 {
                if speechBegan == nil { speechBegan = now }
                lastSpeech = now
                if let speechBegan, now - speechBegan >= 0.18 { heardSpeech = true }
            } else if !heardSpeech {
                speechBegan = nil
            } else if let lastSpeech, now - lastSpeech >= 1.15 {
                recorder.stop()
            }
        }

        nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
            let recorderID = ObjectIdentifier(recorder)
            Task { @MainActor in
                guard let current = self.dictation, ObjectIdentifier(current) == recorderID,
                      let id = self.dictationID else { return }
                let file = flag ? try? Data(contentsOf: current.url) : nil
                let audio = file.flatMap {
                    !$0.isEmpty && $0.count <= 2 * 1024 * 1024 ? $0.base64EncodedString() : nil
                } ?? ""
                let backgroundProcessing = !audio.isEmpty && self.dictationTimer != nil &&
                    self.beginBackgroundReply(id, completingNativeRecording: true)
                self.cancelDictation()
                guard let web = self.web, self.unlocked, KovaDestination.isTrusted(web.url) else {
                    if backgroundProcessing { self.endBackgroundReply() }
                    return
                }
                web.callAsyncJavaScript(
                    """
                    if (location.origin === 'https://kovagpt.com') {
                        window.dispatchEvent(new CustomEvent('kova-native-dictation', { detail: {id, audio, backgroundProcessing} }));
                    }
                    """,
                    arguments: ["id": id, "audio": audio, "backgroundProcessing": backgroundProcessing],
                    in: nil, in: .page
                )
            }
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                                   replyHandler: @escaping (Any?, String?) -> Void) {
            guard message.webView === web, message.frameInfo.isMainFrame,
                  KovaDestination.isTrusted(message.frameInfo.request.url),
                  let value = message.body as? [String: String],
                  let id = value["id"], UUID(uuidString: id) != nil else {
                replyHandler(false, nil)
                return
            }
            if message.name == "kovaDictation" {
                switch value["action"] {
                case "start", "start-voice":
                    startDictation(id, handsFree: value["action"] == "start-voice", reply: replyHandler)
                case "mute":
                    guard id == dictationID, let recorder = dictation, recorder.isRecording else {
                        replyHandler(false, nil)
                        return
                    }
                    recorder.pause()
                    dictationMuted = true
                    speechBegan = nil
                    lastSpeech = nil
                    replyHandler(true, nil)
                case "unmute":
                    guard id == dictationID, let recorder = dictation, dictationMuted else {
                        replyHandler(false, nil)
                        return
                    }
                    let resumed = recorder.record()
                    dictationMuted = !resumed
                    replyHandler(resumed, nil)
                case "finish":
                    if id == dictationID { dictation?.stop() }
                    replyHandler(id == dictationID, nil)
                case "cancel":
                    if id == dictationID { cancelDictation() }
                    replyHandler(true, nil)
                default: replyHandler(false, nil)
                }
                return
            }
            guard message.name == "kovaReadAloud" else { replyHandler(false, nil); return }
            if value["action"] == "stop" {
                if id == readingID { stopReading() }
                replyHandler(true, nil)
                return
            }
            guard unlocked, dictationID == nil,
                  carPlay || UIApplication.shared.applicationState == .active || backgroundReply != .invalid,
                  value["action"] == "play", let audio = value["audio"], audio.utf8.count <= 11_184_812,
                  let data = Data(base64Encoded: audio), !data.isEmpty, data.count <= 8 * 1024 * 1024 else {
                replyHandler(false, nil)
                return
            }
            stopReading()
            let session = AVAudioSession.sharedInstance()
            do {
                let player = try AVAudioPlayer(data: data, fileTypeHint: AVFileType.mp3.rawValue)
                try session.setCategory(.playback, mode: .spokenAudio, options: .duckOthers)
                try session.setActive(true)
                player.delegate = self
                reader = player
                readingID = id
                readingAllowsContinuation = recordedReplyID != nil
                if player.play() {
                    replyHandler(true, nil)
                } else {
                    stopReading()
                    replyHandler(false, nil)
                }
            } catch {
                replyHandler(false, nil)
            }
        }

        func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
            web?.window ?? ASPresentationAnchor()
        }

        private func startGoogleSignIn(_ url: URL) {
            guard web?.window != nil else { return }
            let id = UUID()
            googleSessionID = id
            googleSession?.cancel()
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "kovagpt-native") {
                [weak self] callback, _ in
                Task { @MainActor in
                    guard let self, self.googleSessionID == id else { return }
                    self.googleSessionID = nil
                    self.googleSession = nil
                    if let callback { KovaLaunch.shared.completeGoogleSignIn(callback) }
                }
            }
            googleSession = session
            session.presentationContextProvider = self
            if !session.start() {
                googleSessionID = nil
                googleSession = nil
                UIApplication.shared.open(url)
            }
        }

        func webView(_ web: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if carPlay {
                decisionHandler(KovaDestination.isTrusted(action.request.url) ? .allow : .cancel)
                return
            }
            guard action.targetFrame?.isMainFrame != false else { decisionHandler(.allow); return }
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            if KovaDestination.isTrusted(url) {
                if KovaDestination.isWebsiteOnly(url) {
                    decisionHandler(.cancel)
                    return
                }
                if url.path == "/api/auth/google/start",
                   let challenge = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                    .queryItems?.first(where: { $0.name == "native_challenge" })?.value,
                   challenge.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil {
                    decisionHandler(.cancel)
                    if unlocked && action.sourceFrame.isMainFrame &&
                        KovaDestination.isTrusted(action.sourceFrame.request.url) {
                        startGoogleSignIn(url)
                    }
                    return
                }
                if action.targetFrame == nil {
                    decisionHandler(.cancel)
                    web.load(action.request)
                } else {
                    decisionHandler(.allow)
                }
                return
            }
            decisionHandler(.cancel)
            guard action.sourceFrame.isMainFrame, KovaDestination.isTrusted(action.sourceFrame.request.url),
                  url.scheme == "https", url.user == nil, url.password == nil,
                  action.navigationType == .linkActivated || url.host == "accounts.google.com" else { return }
            UIApplication.shared.open(url)
        }

        func webView(_ web: WKWebView, decidePolicyFor response: WKNavigationResponse,
                     decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            guard response.isForMainFrame else { decisionHandler(.allow); return }
            let url = response.response.url
            decisionHandler(KovaDestination.isTrusted(url) && !KovaDestination.isWebsiteOnly(url) ? .allow : .cancel)
        }

        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                     initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                     decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            let trusted = unlocked && UIApplication.shared.applicationState == .active && frame.isMainFrame && KovaDestination.isTrusted(frame.request.url) &&
                origin.protocol == "https" && origin.host == "kovagpt.com" &&
                (origin.port == 0 || origin.port == 443)
            decisionHandler(trusted ? .prompt : .deny)
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard unlocked, message.webView === web, message.frameInfo.isMainFrame,
                  KovaDestination.isTrusted(message.frameInfo.request.url),
                  let value = message.body as? [String: String] else { return }
            if carPlay {
                switch value["action"] {
                case "carplay-voice-state":
                    if let state = value["state"] { onCarPlayState?(state) }
                case "voice-reply-end":
                    if let id = value["id"], id == backgroundReplyID { endBackgroundReply() }
                default: break
                }
                return
            }
            switch value["action"] {
            case "voice-reply-begin":
                if let id = value["id"] { beginBackgroundReply(id) }
            case "voice-reply-end":
                if let id = value["id"], id == backgroundReplyID { endBackgroundReply() }
            case "haptic": UISelectionFeedbackGenerator().selectionChanged()
            case "device-lock": changeLock()
            case "share":
                guard let text = value["text"], !text.isEmpty, text.utf16.count <= 32_768,
                      let web, let root = web.window?.rootViewController else { return }
                var presenter = root
                while let current = presenter.presentedViewController { presenter = current }
                guard !(presenter is UIActivityViewController) else { return }
                let sheet = UIActivityViewController(activityItems: [text], applicationActivities: nil)
                sheet.popoverPresentationController?.sourceView = web
                sheet.popoverPresentationController?.sourceRect = CGRect(
                    x: web.bounds.midX, y: web.bounds.midY, width: 1, height: 1
                )
                presenter.present(sheet, animated: true)
            default: break
            }
        }
    }
}

// Keeps the CarPlay display voice-only. The web view shares the phone app's
// sign-in and uses the same owner-bound transcription and saved reply flow.
@MainActor
final class KovaCarPlayScene: UIResponder, CPTemplateApplicationSceneDelegate {
    private var interface: CPInterfaceController?
    private var web: WKWebView?
    private var coordinator: KovaChatWebView.Coordinator?
    private var timeout: Task<Void, Never>?
    private var statusItem: CPListItem?

    func templateApplicationScene(_ scene: CPTemplateApplicationScene, didConnect controller: CPInterfaceController) {
        interface = controller
        render()
    }

    func templateApplicationScene(_ scene: CPTemplateApplicationScene, didDisconnect controller: CPInterfaceController) {
        interface = nil
        stop()
    }

    private func render(note: String? = nil) {
        let active = web != nil
        let item = CPListItem(text: active ? "Stop Voice" : "Start Voice", detailText: note)
        statusItem = item
        item.handler = { [weak self] _, completion in
            defer { completion() }
            guard let self else { return }
            if self.web != nil { self.stop() }
            else { self.start() }
        }
        interface?.setRootTemplate(
            CPListTemplate(title: "KovaGPT", sections: [CPListSection(items: [item])]),
            animated: false, completion: nil
        )
    }

    private func start() {
        guard #available(iOS 26.4, *), !UserDefaults.standard.bool(forKey: "kova.device-lock"),
              AVAudioApplication.shared.recordPermission == .granted else {
            render(note: "Set up Voice on your iPhone while parked.")
            return
        }
        let coordinator = KovaChatWebView.Coordinator(changeLock: {})
        coordinator.carPlay = true
        coordinator.unlocked = true
        coordinator.onCarPlayState = { [weak self] state in
            guard let self else { return }
            switch state {
            case "listening":
                self.timeout?.cancel()
                self.timeout = nil
                self.statusItem?.setDetailText("Listening")
            case "working": self.statusItem?.setDetailText("Preparing reply")
            case "speaking": self.statusItem?.setDetailText("Speaking")
            case "ended": self.stop(note: "Voice ended. Tap Start Voice to try again.")
            default: break
            }
        }
        let web = KovaChatWebView.makeWebView(coordinator: coordinator)
        self.coordinator = coordinator
        self.web = web
        render(note: "Connecting")
        web.load(URLRequest(url: KovaDestination.voice.url))
        timeout = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: .seconds(20)) } catch { return }
            self?.stop(note: "Open KovaGPT on your iPhone while parked.")
        }
    }

    private func stop(note: String? = nil) {
        timeout?.cancel()
        timeout = nil
        if let web, let coordinator {
            coordinator.signal("kova-native-audio-interruption")
            web.stopLoading()
            KovaChatWebView.dismantleUIView(web, coordinator: coordinator)
        }
        coordinator = nil
        web = nil
        render(note: note)
    }
}
