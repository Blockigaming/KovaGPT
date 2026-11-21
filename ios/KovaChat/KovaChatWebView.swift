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
            coordinator.stopReading(notifyPage: true)
            coordinator.signal("kova-native-audio-interruption")
        }
        coordinator.unlocked = unlocked
        guard unlocked, coordinator.request != request.id else { return }
        coordinator.request = request.id
        if request.destination == .voice, KovaDestination.isTrusted(web.url), web.url?.path == "/" {
            coordinator.signal("kova-native-open-voice")
        } else {
            web.load(URLRequest(url: request.destination.url))
        }
    }

    static func dismantleUIView(_ web: WKWebView, coordinator: Coordinator) {
        web.configuration.userContentController.removeScriptMessageHandler(forName: "kovaNative")
        web.configuration.userContentController.removeScriptMessageHandler(forName: "kovaReadAloud", contentWorld: .page)
        coordinator.stop()
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler,
        WKScriptMessageHandlerWithReply, AVAudioPlayerDelegate {
        var request: UUID?
        var unlocked = false
        var changeLock: () -> Void
        weak var web: WKWebView?
        private var audioObservers: [NSObjectProtocol] = []
        private var reader: AVAudioPlayer?
        private var readingID: String?

        init(changeLock: @escaping () -> Void) {
            self.changeLock = changeLock
            super.init()
            let center = NotificationCenter.default
            audioObservers.append(center.addObserver(
                forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
            ) { [weak self] notification in
                guard notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt ==
                    AVAudioSession.InterruptionType.began.rawValue else { return }
                Task { @MainActor in
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
                    self?.stopReading(notifyPage: true)
                    self?.signal("kova-native-audio-interruption")
                }
            })
        }

        func stop() {
            stopReading()
            for observer in audioObservers { NotificationCenter.default.removeObserver(observer) }
            audioObservers.removeAll()
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

        func webView(_ web: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            stopReading()
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                                   replyHandler: @escaping (Any?, String?) -> Void) {
            guard message.name == "kovaReadAloud", message.webView === web, message.frameInfo.isMainFrame,
                  KovaDestination.isTrusted(message.frameInfo.request.url),
                  let value = message.body as? [String: String],
                  let id = value["id"], UUID(uuidString: id) != nil else {
                replyHandler(false, nil)
                return
            }
            if value["action"] == "stop" {
                if id == readingID { stopReading() }
                replyHandler(true, nil)
                return
            }
            guard unlocked, UIApplication.shared.applicationState == .active,
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

        func webView(_ web: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard action.targetFrame?.isMainFrame != false else { decisionHandler(.allow); return }
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            if KovaDestination.isTrusted(url) {
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
