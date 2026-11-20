import HealthKit
import SwiftUI
import WebKit

@main
struct KovaHealthApp: App {
    var body: some Scene {
        WindowGroup { HealthConnectionsView() }
    }
}

struct HealthConnectionsView: UIViewRepresentable {
    func makeCoordinator() -> HealthConnectionsBridge { HealthConnectionsBridge() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(context.coordinator, name: "kovaHealth")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        context.coordinator.webView = webView
        webView.load(URLRequest(url: URL(string: "https://kovagpt.com/apps?connection_view=health")!))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: HealthConnectionsBridge) {
        coordinator.stop()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "kovaHealth")
    }
}

@MainActor final class HealthConnectionsBridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    weak var webView: WKWebView?
    private let store = HKHealthStore()
    private var id: UUID?
    private var observers: [HKObserverQuery] = []
    private var refresh: Task<Void, Never>?
    private var needsRefresh = false
    private var activation: NSObjectProtocol?

    private func trusted(_ url: URL?) -> Bool {
        url?.scheme == "https" && url?.host == "kovagpt.com" && url?.user == nil &&
            url?.password == nil && (url?.port == nil || url?.port == 443)
    }

    private func healthPage(_ url: URL?) -> Bool {
        guard trusted(url), let url, url.path == "/apps" else { return false }
        return URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains {
            $0.name == "connection_view" && $0.value == "health"
        } ?? false
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigation: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard navigation.targetFrame?.isMainFrame != false else { decisionHandler(.allow); return }
        if trusted(navigation.request.url) {
            if navigation.targetFrame == nil {
                webView.load(navigation.request)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
        } else {
            decisionHandler(.cancel)
            if navigation.navigationType == .linkActivated, let url = navigation.request.url,
               url.scheme == "https" {
                UIApplication.shared.open(url)
            }
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        stop()
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "kovaHealth", message.frameInfo.isMainFrame,
              trusted(message.frameInfo.request.url),
              message.webView === webView,
              let request = message.body as? [String: String],
              let rawId = request["id"], let requestedId = UUID(uuidString: rawId) else { return }
        if request["action"] == "stop", requestedId == id {
            stop()
            return
        }
        guard request["action"] == "start", id == nil, healthPage(webView?.url) else { return }
        id = requestedId
        guard HKHealthStore.isHealthDataAvailable(), let presenter = webView?.window?.rootViewController else {
            sendError(requestedId)
            return
        }

        let alert = UIAlertController(
            title: "Connect Apple Health",
            message: "Show the health trends you allow on this iPhone while this Health tab is open. KovaGPT will read daily summaries on this device.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
            self?.sendError(requestedId)
        })
        alert.addAction(UIAlertAction(title: "Continue", style: .default) { [weak self] _ in
            Task { await self?.authorize(requestedId) }
        })
        presenter.present(alert, animated: true)
    }

    private func authorize(_ session: UUID) async {
        guard id == session, healthPage(webView?.url) else { stop(); return }
        let types = LiveHealthAnalytics.sampleTypes
        do {
            try await store.requestAuthorization(toShare: [], read: Set(types.map { $0 as HKObjectType }))
            guard id == session, healthPage(webView?.url) else { return }
            for type in types {
                let query = HKObserverQuery(sampleType: type, predicate: nil) { [weak self] _, completed, error in
                    completed()
                    if error == nil {
                        Task { @MainActor in self?.scheduleRead() }
                    }
                }
                observers.append(query)
                store.execute(query)
            }
            activation = NotificationCenter.default.addObserver(
                forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
            ) { [weak self] _ in
                Task { @MainActor in self?.scheduleRead() }
            }
            scheduleRead()
        } catch {
            sendError(session)
        }
    }

    private func scheduleRead() {
        guard let session = id, healthPage(webView?.url),
              UIApplication.shared.applicationState == .active else { return }
        if refresh != nil { needsRefresh = true; return }
        refresh = Task { [weak self] in
            guard let self else { return }
            repeat {
                needsRefresh = false
                let report = await LiveHealthAnalytics.read(from: store)
                guard !Task.isCancelled, id == session else { return }
                if healthPage(webView?.url),
                   let data = try? JSONEncoder().encode(report),
                   let value = try? JSONSerialization.jsonObject(with: data) {
                    send(["report": value], session: session)
                }
            } while needsRefresh
            refresh = nil
        }
    }

    private func sendError(_ session: UUID) {
        guard id == session else { return }
        send(["state": "error"], session: session)
        stop()
    }

    private func send(_ data: [String: Any], session: UUID) {
        guard let webView, healthPage(webView.url) else { return }
        var payload = data
        payload["id"] = session.uuidString.lowercased()
        webView.callAsyncJavaScript(
            """
            if (location.origin === 'https://kovagpt.com' && location.pathname === '/apps' &&
                new URLSearchParams(location.search).get('connection_view') === 'health') {
              window.dispatchEvent(new CustomEvent('kova-health-update-v1', {detail: payload}));
            }
            """,
            arguments: ["payload": payload], in: nil, in: .page
        )
    }

    func stop() {
        refresh?.cancel()
        refresh = nil
        needsRefresh = false
        id = nil
        for query in observers { store.stop(query) }
        observers.removeAll()
        if let activation { NotificationCenter.default.removeObserver(activation) }
        activation = nil
    }
}
