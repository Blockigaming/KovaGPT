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
    private var owner: UUID?
    private static let connectionKey = "kova.health.approvedOwner"
    private var observers: [HKObserverQuery] = []
    private var refresh: Task<Void, Never>?
    private var needsFullRead = false
    private var changedTypes: Set<String> = []
    private var latest: LiveHealthAnalytics?
    private var activation: NSObjectProtocol?
    private var deactivation: NSObjectProtocol?

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
        if requestedId == id {
            if request["action"] == "disconnect" {
                if owner?.uuidString == UserDefaults.standard.string(forKey: Self.connectionKey) {
                    UserDefaults.standard.removeObject(forKey: Self.connectionKey)
                }
                stop()
                return
            }
            if request["action"] == "stop" { stop(); return }
        }
        guard let action = request["action"], action == "resume" || action == "start",
              id == nil, healthPage(webView?.url),
              let rawOwner = request["owner"], let requestedOwner = UUID(uuidString: rawOwner) else { return }
        id = requestedId
        owner = requestedOwner
        guard HKHealthStore.isHealthDataAvailable() else { sendError(requestedId); return }
        if action == "resume" {
            if UserDefaults.standard.string(forKey: Self.connectionKey) == requestedOwner.uuidString {
                observe(LiveHealthAnalytics.sampleTypes)
            } else {
                send(["state": "not_connected"], session: requestedId)
                stop()
            }
            return
        }
        guard let presenter = webView?.window?.rootViewController else { sendError(requestedId); return }
        let alert = UIAlertController(
            title: "Connect Apple Health",
            message: "Automatically refresh the health trends you allow in this tab on this iPhone. Your Apple Health readings stay on this device.",
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
        guard id == session, healthPage(webView?.url) else { return }
        let types = LiveHealthAnalytics.sampleTypes
        do {
            try await store.requestAuthorization(toShare: [], read: Set(types.map { $0 as HKObjectType }))
            guard id == session, healthPage(webView?.url) else { return }
            if let owner {
                UserDefaults.standard.set(owner.uuidString, forKey: Self.connectionKey)
            }
            observe(types)
        } catch {
            sendError(session)
        }
    }

    private func observe(_ types: [HKSampleType]) {
        for type in types {
            let identifier = type.identifier
            let query = HKObserverQuery(sampleType: type, predicate: nil) { [weak self] _, completed, error in
                completed()
                if error == nil {
                    Task { @MainActor in self?.scheduleRead(changedType: identifier) }
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
        deactivation = NotificationCenter.default.addObserver(
            forName: UIApplication.willResignActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.pauseRead() }
        }
        scheduleRead()
    }

    private func scheduleRead(changedType: String? = nil) {
        guard let session = id, healthPage(webView?.url),
              UIApplication.shared.applicationState == .active else { return }
        if let changedType { changedTypes.insert(changedType) }
        else { needsFullRead = true }
        guard refresh == nil else { return }
        refresh = Task { [weak self] in
            guard let self else { return }
            repeat {
                // Observer queries can fire in a burst when the Watch syncs.
                try? await Task.sleep(for: .milliseconds(750))
                guard !Task.isCancelled, id == session else { return }
                let changed = needsFullRead ? [] : changedTypes
                needsFullRead = false
                changedTypes.removeAll()
                let report = await LiveHealthAnalytics.read(from: store, changing: changed, previous: latest)
                guard !Task.isCancelled, id == session else { return }
                latest = report
                if UIApplication.shared.applicationState == .active, healthPage(webView?.url),
                   let data = try? JSONEncoder().encode(report),
                   let value = try? JSONSerialization.jsonObject(with: data) {
                    send(["report": value], session: session)
                }
            } while needsFullRead || !changedTypes.isEmpty
            refresh = nil
        }
    }

    private func pauseRead() {
        guard let id, UIApplication.shared.applicationState != .active else { return }
        refresh?.cancel()
        refresh = nil
        latest = nil
        send(["state": "paused"], session: id)
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
        needsFullRead = false
        changedTypes.removeAll()
        latest = nil
        id = nil
        owner = nil
        for query in observers { store.stop(query) }
        observers.removeAll()
        if let activation { NotificationCenter.default.removeObserver(activation) }
        activation = nil
        if let deactivation { NotificationCenter.default.removeObserver(deactivation) }
        deactivation = nil
    }
}
