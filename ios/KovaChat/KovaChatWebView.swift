import AuthenticationServices
import AVFoundation
import SwiftUI
import WebKit

struct KovaChatWebView: UIViewRepresentable {
    let request: KovaLaunch.Request
    let unlocked: Bool
    let changeLock: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(changeLock: changeLock) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.applicationNameForUserAgent = "KovaGPTNative/iOS"
        configuration.userContentController.add(context.coordinator, name: "kovaNative")
        configuration.userContentController.addScriptMessageHandler(
            context.coordinator, contentWorld: .page, name: "kovaReadAloud"
        )
        configuration.userContentController.addScriptMessageHandler(
            context.coordinator, contentWorld: .page, name: "kovaDictation"
        )
        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = true
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.isOpaque = false
        context.coordinator.web = web
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
        var changeLock: () -> Void
        weak var web: WKWebView?
        private var textSizeObserver: NSObjectProtocol?
        private var audioObservers: [NSObjectProtocol] = []
        private var dictation: AVAudioRecorder?
        private var dictationID: String?
        private var reader: AVAudioPlayer?
        private var readingID: String?
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
            if task != .invalid { UIApplication.shared.endBackgroundTask(task) }
        }

        private func beginBackgroundReply(_ id: String) {
            guard UIApplication.shared.applicationState == .active, UUID(uuidString: id) != nil else { return }
            endBackgroundReply()
            let task = UIApplication.shared.beginBackgroundTask(withName: "Kova voice reply") {
                [weak self] in
                Task { @MainActor in
                    guard let self, self.backgroundReplyID == id else { return }
                    self.endBackgroundReply()
                    self.signal("kova-native-audio-interruption")
                }
            }
            guard task != .invalid else { return }
            backgroundReply = task
            backgroundReplyID = id
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
            guard let recorder = dictation else { return }
            dictation = nil
            recorder.delegate = nil
            recorder.stop()
            try? FileManager.default.removeItem(at: recorder.url)
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }

        private func startDictation(_ id: String, reply: @escaping (Any?, String?) -> Void) {
            guard UIApplication.shared.applicationState == .active, unlocked, dictationID == nil else {
                reply(false, nil)
                return
            }
            dictationID = id
            AVAudioApplication.requestRecordPermission { [weak self] granted in
                Task { @MainActor in
                    guard let self, self.dictationID == id else { reply(false, nil); return }
                    guard granted, self.unlocked, UIApplication.shared.applicationState == .active else {
                        self.cancelDictation()
                        reply(false, nil)
                        return
                    }
                    self.stopReading(notifyPage: true)
                    let audio = AVAudioSession.sharedInstance()
                    let url = FileManager.default.temporaryDirectory
                        .appendingPathComponent(UUID().uuidString).appendingPathExtension("m4a")
                    do {
                        try audio.setCategory(.playAndRecord, mode: .default, options: .defaultToSpeaker)
                        try audio.setActive(true)
                        let recorder = try AVAudioRecorder(url: url, settings: [
                            AVFormatIDKey: kAudioFormatMPEG4AAC,
                            AVSampleRateKey: 24000,
                            AVNumberOfChannelsKey: 1,
                            AVEncoderBitRateKey: 64000
                        ])
                        self.dictation = recorder
                        recorder.delegate = self
                        guard recorder.record(forDuration: 59) else {
                            self.cancelDictation()
                            reply(false, nil)
                            return
                        }
                        reply(true, nil)
                    } catch {
                        self.cancelDictation()
                        try? FileManager.default.removeItem(at: url)
                        try? audio.setActive(false, options: .notifyOthersOnDeactivation)
                        reply(false, nil)
                    }
                }
            }
        }

        nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
            let recorderID = ObjectIdentifier(recorder)
            Task { @MainActor in
                guard let current = self.dictation, ObjectIdentifier(current) == recorderID,
                      let id = self.dictationID else { return }
                let file = flag ? try? Data(contentsOf: current.url) : nil
                self.cancelDictation()
                guard let web = self.web, self.unlocked, KovaDestination.isTrusted(web.url) else { return }
                web.callAsyncJavaScript(
                    """
                    if (location.origin === 'https://kovagpt.com') {
                        window.dispatchEvent(new CustomEvent('kova-native-dictation', { detail: {id, audio} }));
                    }
                    """,
                    arguments: ["id": id, "audio": file.flatMap {
                        !$0.isEmpty && $0.count <= 1024 * 1024 ? $0.base64EncodedString() : nil
                    } ?? ""], in: nil, in: .page
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
                case "start": startDictation(id, reply: replyHandler)
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
                  UIApplication.shared.applicationState == .active || backgroundReply != .invalid,
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
            guard action.targetFrame?.isMainFrame != false else { decisionHandler(.allow); return }
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            if KovaDestination.isTrusted(url) {
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
            decisionHandler(KovaDestination.isTrusted(response.response.url) ? .allow : .cancel)
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
