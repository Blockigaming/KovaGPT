import SwiftUI
import WebKit
import VisionKit
import PDFKit
import PhotosUI

/// Shortcuts accept only known in-app actions, never arbitrary web URLs or commands.
private enum NativeShortcut: String {
    case newChat = "new-chat"
    case scan = "scan"
    case camera = "camera"
    case photos = "photos"
    case voice = "voice"
    case microphone = "microphone"

    init?(url: URL) {
        guard url.scheme?.lowercased() == "kovagpt",
              let name = url.host?.lowercased(),
              url.user == nil, url.password == nil, url.port == nil,
              (url.path.isEmpty || url.path == "/"),
              url.query == nil, url.fragment == nil else { return nil }
        self.init(rawValue: name)
    }
}

private struct ShortcutRequest {
    let id: UUID
    let action: NativeShortcut
}

@main
struct KovaGPTApp: App {
    @State private var shortcut: ShortcutRequest?

    var body: some Scene {
        WindowGroup {
            NativeBrowser(shortcut: shortcut)
                .onOpenURL { url in
                    guard let action = NativeShortcut(url: url) else { return }
                    shortcut = ShortcutRequest(id: UUID(), action: action)
                }
        }
    }
}

struct NativeBrowser: UIViewControllerRepresentable {
    fileprivate let shortcut: ShortcutRequest?

    func makeUIViewController(context: Context) -> UINavigationController {
        UINavigationController(rootViewController: BrowserController())
    }

    func updateUIViewController(_ controller: UINavigationController, context: Context) {
        guard let shortcut,
              let browser = controller.viewControllers.first as? BrowserController else { return }
        browser.accept(shortcut)
    }
}

/// Native iPhone/iPad viewer. The only message handler accepts bounded Voice phase
/// labels from the active first-party main frame. Scans stay local until shared.
private final class VoiceActivityMessageProxy: NSObject, WKScriptMessageHandler {
    weak var controller: BrowserController?
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        controller?.receiveVoiceActivity(message)
    }
}

final class BrowserController: UIViewController, WKNavigationDelegate,
                               VNDocumentCameraViewControllerDelegate,
                               UINavigationControllerDelegate,
                               UIImagePickerControllerDelegate,
                               PHPickerViewControllerDelegate {
    private var browser: WKWebView!
    private var accountBrowsers: [Int: WKWebView] = [:]
    private var accountSlot = 1
    private var switchingAccount = false
    private var voiceActivityStorage: AnyObject?
    @available(iOS 16.1, *)
    private var voiceActivity: NativeVoiceActivity {
        if let existing = voiceActivityStorage as? NativeVoiceActivity { return existing }
        let coordinator = NativeVoiceActivity()
        voiceActivityStorage = coordinator
        return coordinator
    }

    fileprivate func receiveVoiceActivity(_ message: WKScriptMessage) {
        guard message.name == "kovaVoiceActivity", message.frameInfo.isMainFrame,
              message.webView === browser,
              message.frameInfo.securityOrigin.protocol == "https",
              message.frameInfo.securityOrigin.host == "kovagpt.com",
              [0, 443].contains(message.frameInfo.securityOrigin.port),
              let url = browser.url, isKova(url),
              let body = message.body as? [String: String], body.count == 1,
              let phase = body["phase"], phase.count <= 20 else { return }
        if #available(iOS 16.1, *) { voiceActivity.receive(phase) }
    }

    @objc private func activityBackgrounded() {
        if #available(iOS 16.1, *), let activity = voiceActivityStorage as? NativeVoiceActivity { activity.enteredBackground() }
    }
    @objc private func activityForegrounded() {
        if #available(iOS 16.1, *), let activity = voiceActivityStorage as? NativeVoiceActivity { activity.enteredForeground() }
    }
    private func endVoiceActivity() {
        if #available(iOS 16.1, *), let activity = voiceActivityStorage as? NativeVoiceActivity { activity.end() }
    }

    private static let voiceObserver = """
        (() => {
          if (location.origin !== 'https://kovagpt.com' || window.top !== window) return;
          let previous = '';
          const publish = () => {
            const node = document.querySelector('.kova-voice-dialog[data-voice-mode="voice"]');
            const phase = node && node.getClientRects().length ? node.getAttribute('data-voice-phase') : 'inactive';
            if (phase === previous) return;
            previous = phase;
            window.webkit.messageHandlers.kovaVoiceActivity.postMessage({phase});
          };
          new MutationObserver(publish).observe(document.documentElement, {subtree: true, childList: true, attributes: true, attributeFilter: ['data-voice-phase', 'data-state', 'data-voice-mode']});
          publish();
          window.addEventListener('pagehide', () => window.webkit.messageHandlers.kovaVoiceActivity.postMessage({phase:'inactive'}));
        })();
        """
    private var lastShortcutID: UUID?
    private var pendingShortcut: NativeShortcut?
    private var pendingWebShortcut: (id: UUID, action: NativeShortcut)?

    fileprivate func accept(_ request: ShortcutRequest) {
        guard lastShortcutID != request.id else { return }
        lastShortcutID = request.id
        pendingShortcut = request.action
        runShortcutIfVisible()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        runShortcutIfVisible()
    }

    private func runShortcutIfVisible() {
        guard isViewLoaded, view.window != nil, presentedViewController == nil,
              let action = pendingShortcut else { return }
        pendingShortcut = nil
        pendingWebShortcut = nil
        switch action {
        case .newChat:
            browser.load(URLRequest(url: URL(string: "https://kovagpt.com/")!))
        case .scan:
            scanDocument()
        case .camera:
            takePhoto()
        case .photos:
            choosePhoto()
        case .voice, .microphone:
            // The widget may open the web voice/dictation interface but never
            // starts recording or grants a microphone permission automatically.
            let token = UUID()
            pendingWebShortcut = (id: token, action: action)
            if let url = browser.url, isKova(url) {
                openPendingWebShortcut(token: token, remainingAttempts: 10)
            } else { browser.load(URLRequest(url: URL(string: "https://kovagpt.com/")!)) }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === browser, let token = pendingWebShortcut?.id else { return }
        openPendingWebShortcut(token: token, remainingAttempts: 10)
    }

    private func openPendingWebShortcut(token: UUID, remainingAttempts: Int) {
        guard let request = pendingWebShortcut, request.id == token,
              let url = browser.url, isKova(url) else { return }
        let testID = request.action == .voice ? "voice-button" : "dictate-button"
        // Native fixed-selector click is scoped to the real Kova composer.
        // The web dialog still requires an explicit user Start for microphone use.
        let script = """
            (function() {
              const existing = document.querySelector('\(request.action == .voice ? ".kova-voice-dialog[data-voice-mode=voice]" : "#kova-inline-dictation")');
              if (existing && existing.getClientRects().length) return true;
              const button = document.querySelector('button[data-testid="\(testID)"]');
              if (!button || button.disabled || button.hidden ||
                  button.getClientRects().length === 0) return false;
              button.click();
              return true;
            })()
            """
        browser.evaluateJavaScript(script) { [weak self] result, _ in
            DispatchQueue.main.async {
                guard let self, self.pendingWebShortcut?.id == token else { return }
                if result as? Bool == true {
                    self.pendingWebShortcut = nil
                } else if remainingAttempts > 1 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                        self.openPendingWebShortcut(token: token,
                                                     remainingAttempts: remainingAttempts - 1)
                    }
                } else {
                    self.pendingWebShortcut = nil
                    self.showMessage("Open a chat and sign in to use this voice shortcut.")
                }
            }
        }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "KovaGPT"
        view.backgroundColor = .systemBackground
        NotificationCenter.default.addObserver(self, selector: #selector(activityBackgrounded), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(activityForegrounded), name: UIApplication.didBecomeActiveNotification, object: nil)

        showAccount(1)
        navigationItem.leftBarButtonItem = UIBarButtonItem(
            title: "Back", style: .plain, target: self, action: #selector(goBack)
        )
        navigationItem.rightBarButtonItems = [
            UIBarButtonItem(title: "Share", style: .plain, target: self,
                            action: #selector(sharePage)),
            UIBarButtonItem(title: "Scan", style: .plain, target: self,
                            action: #selector(scanDocument)),
            UIBarButtonItem(title: "Settings", style: .plain, target: self,
                            action: #selector(showNativeSettings)),
        ]
    }

    /// Slot one preserves the existing default sign-in. Slot two has its own persistent
    /// WebKit container; neither cookies nor account tokens are copied between slots.
    private func showAccount(_ slot: Int) {
        guard slot == 1 || slot == 2 else { return }
        if slot == 2 {
            guard #available(iOS 17.0, *) else { return }
        }
        endVoiceActivity()
        browser?.pauseAllMediaPlayback(completionHandler: nil)
        browser?.removeFromSuperview()
        let selected: WKWebView
        if let retained = accountBrowsers[slot] {
            selected = retained
        } else {
            let config = WKWebViewConfiguration()
            guard let store = AccountWebStores.store(for: slot) else { return }
            config.websiteDataStore = store
            config.preferences.javaScriptCanOpenWindowsAutomatically = false
            let voiceProxy = VoiceActivityMessageProxy()
            voiceProxy.controller = self
            config.userContentController.add(voiceProxy, name: "kovaVoiceActivity")
            config.userContentController.addUserScript(WKUserScript(source: Self.voiceObserver, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
            selected = WKWebView(frame: .zero, configuration: config)
            selected.navigationDelegate = self
            selected.allowsBackForwardNavigationGestures = true
            selected.translatesAutoresizingMaskIntoConstraints = false
            accountBrowsers[slot] = selected
            selected.load(URLRequest(url: URL(string: "https://kovagpt.com/")!))
        }
        browser = selected
        accountSlot = slot
        pendingShortcut = nil
        pendingWebShortcut = nil
        view.addSubview(selected)
        NSLayoutConstraint.activate([
            selected.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            selected.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            selected.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            selected.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
        ])
        title = "KovaGPT · Account \(slot)"
    }

    private func requestAccountSwitch() {
        guard #available(iOS 17.0, *) else {
            showMessage("Switching between two saved accounts requires iOS 17 or later.")
            return
        }
        guard !switchingAccount, let active = browser, let url = active.url, isKova(url) else { return }
        switchingAccount = true
        // Voice and dictation must end before another account can be shown. This is
        // a fixed, read-only check in the first-party page, not a privileged web API.
        let script = "Array.from(document.querySelectorAll('.kova-voice-dialog, #kova-inline-dictation')).some(e => e.getClientRects().length > 0)"
        active.evaluateJavaScript(script) { [weak self, weak active] result, error in
            DispatchQueue.main.async {
                guard let self else { return }
                self.switchingAccount = false
                guard let active, active === self.browser, let currentURL = active.url,
                      self.isKova(currentURL), error == nil,
                      let blocked = result as? Bool else {
                    self.showMessage("This account could not be switched. Try again once the page has loaded.")
                    return
                }
                guard !blocked else {
                    self.showMessage("Finish Voice or Dictation before switching accounts. Your current session stays open.")
                    return
                }
                self.confirmNativeAction()
                self.showAccount(self.accountSlot == 1 ? 2 : 1)
            }
        }
    }

    @objc private func showNativeSettings() {
        let controller = NativeSettingsController()
        controller.accountSlot = accountSlot
        controller.switchAccount = { [weak self] in
            self?.navigationController?.popViewController(animated: true)
            self?.requestAccountSwitch()
        }
        controller.openVoiceSettings = { [weak self] in
            guard let self else { return }
            self.navigationController?.popViewController(animated: true)
            self.browser.load(URLRequest(url: URL(string: "https://kovagpt.com/settings/voice")!))
        }
        controller.showAbout = { [weak self] in self?.showAbout() }
        navigationController?.pushViewController(controller, animated: true)
    }

    private func isKova(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https" &&
        url.host?.lowercased() == "kovagpt.com" &&
        url.user == nil && url.password == nil &&
        (url.port == nil || url.port == 443)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        if webView === browser { endVoiceActivity() }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.targetFrame?.isMainFrame == false {
            decisionHandler(.allow)
            return
        }
        guard let url = action.request.url else {
            decisionHandler(.cancel)
            return
        }
        if isKova(url) {
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
        guard webView === browser else { return }
        guard url.scheme?.lowercased() == "https",
              url.host != nil, url.user == nil, url.password == nil else { return }
        let alert = UIAlertController(
            title: "Open outside KovaGPT?",
            message: "Open \(url.host!) in your browser?",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Open", style: .default) { _ in
            UIApplication.shared.open(url)
        })
        present(alert, animated: true)
    }

    @objc private func goBack() {
        guard browser.canGoBack else { return }
        confirmNativeAction()
        browser.goBack()
    }

    @objc private func sharePage() {
        guard let url = browser.url, isKova(url) else { return }
        confirmNativeAction()
        share([url])
    }

    private func share(_ items: [Any]) {
        let controller = UIActivityViewController(activityItems: items,
                                                   applicationActivities: nil)
        if let popover = controller.popoverPresentationController {
            popover.barButtonItem = navigationItem.rightBarButtonItems?.first
        }
        present(controller, animated: true)
    }

    private let hapticsKey = "KovaGPTNativeHapticsEnabled"

    private func confirmNativeAction() {
        // Only native user actions use feedback. No browser script can trigger it.
        guard UserDefaults.standard.bool(forKey: hapticsKey) else { return }
        UISelectionFeedbackGenerator().selectionChanged()
    }

    @objc private func showAbout() {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString")
            as? String ?? "Unavailable"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion")
            as? String ?? "Unavailable"
        let enabled = UserDefaults.standard.bool(forKey: hapticsKey)
        let alert = UIAlertController(
            title: "About KovaGPT",
            message: "Version \(version) (build \(build))",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(
            title: enabled ? "Turn haptics off" : "Turn haptics on",
            style: .default
        ) { _ in
            UserDefaults.standard.set(!enabled, forKey: self.hapticsKey)
            if !enabled { self.confirmNativeAction() }
        })
        alert.addAction(UIAlertAction(title: "Close", style: .cancel))
        (navigationController?.topViewController ?? self).present(alert, animated: true)
    }

    /// Only a user-initiated shortcut can present these native selectors.
    /// A selected image is shared explicitly, never sent to Kova's servers.
    private func takePhoto() {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            showMessage("A camera is not available on this device.")
            return
        }
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = self
        present(picker, animated: true)
    }

    private func choosePhoto() {
        var configuration = PHPickerConfiguration(photoLibrary: .shared())
        configuration.selectionLimit = 1
        configuration.filter = .images
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = self
        present(picker, animated: true)
    }

    private func shareChosenPhoto(_ image: UIImage) {
        // Re-encoding excludes the original file's metadata, including GPS tags.
        guard let data = image.jpegData(compressionQuality: 0.9) else {
            showMessage("This image could not be prepared.")
            return
        }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("KovaGPT-Photo-\(UUID().uuidString)")
            .appendingPathExtension("jpg")
        do {
            try data.write(to: url, options: .atomic)
            share([url])
        } catch {
            showMessage("Could not prepare the selected photo.")
        }
    }

    func imagePickerController(_ picker: UIImagePickerController,
                               didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        picker.dismiss(animated: true) {
            guard let image = info[.originalImage] as? UIImage else {
                self.showMessage("No image was captured.")
                return
            }
            self.shareChosenPhoto(image)
        }
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let provider = results.first?.itemProvider else { return }
        guard provider.canLoadObject(ofClass: UIImage.self) else {
            showMessage("This photo cannot be opened.")
            return
        }
        provider.loadObject(ofClass: UIImage.self) { [weak self] item, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                guard let image = item as? UIImage else {
                    self.showMessage("The selected photo could not be loaded.")
                    return
                }
                self.shareChosenPhoto(image)
            }
        }
    }

    @objc private func scanDocument() {
        confirmNativeAction()
        guard VNDocumentCameraViewController.isSupported else {
            showMessage("Document scanning is not supported on this device.")
            return
        }
        let scanner = VNDocumentCameraViewController()
        scanner.delegate = self
        present(scanner, animated: true)
    }

    func documentCameraViewController(_ controller: VNDocumentCameraViewController,
                                     didFinishWith scan: VNDocumentCameraScan) {
        controller.dismiss(animated: true) {
            let document = PDFDocument()
            for index in 0..<scan.pageCount {
                if let page = PDFPage(image: scan.imageOfPage(at: index)) {
                    document.insert(page, at: document.pageCount)
                }
            }
            guard document.pageCount > 0, let pdf = document.dataRepresentation() else {
                self.showMessage("The scanned pages could not be converted into a PDF.")
                return
            }
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("KovaGPT-Scan-\(UUID().uuidString)")
                .appendingPathExtension("pdf")
            do {
                try pdf.write(to: url, options: .atomic)
                // The user chooses Save to Files, Share or another destination.
                // Never automatically attach or upload the document.
                self.share([url])
            } catch {
                self.showMessage("Could not save the scanned PDF.")
            }
        }
    }

    func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true)
    }

    func documentCameraViewController(_ controller: VNDocumentCameraViewController,
                                     didFailWithError error: Error) {
        controller.dismiss(animated: true) {
            self.showMessage("Document scanning was unsuccessful.")
        }
    }

    private func showMessage(_ text: String) {
        let alert = UIAlertController(title: "KovaGPT", message: text, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}


/// Native settings remain separate from provider credentials and server eligibility.
final class NativeSettingsController: UITableViewController {
    var accountSlot = 1
    var switchAccount: (() -> Void)?
    var openVoiceSettings: (() -> Void)?
    var showAbout: (() -> Void)?

    init() { super.init(style: .insetGrouped) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() { super.viewDidLoad(); title = "Settings" }
    override func numberOfSections(in tableView: UITableView) -> Int { 3 }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        section == 1 ? 2 : 1
    }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        ["Accounts", "Voice", "Application"][section]
    }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        if section == 0 {
            return "Account \(accountSlot) is selected. Each account keeps its own sign-in, chats and drafts. Sign in separately the first time you open the other account. Two saved accounts require iOS 17 or later."
        }
        if section == 1 { return "Speech uses ElevenLabs through your Kova account. Recording still requires an explicit start and microphone permission." }
        return nil
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
        if indexPath.section == 0 { cell.textLabel?.text = "Switch to Account \(accountSlot == 1 ? 2 : 1)" }
        else if indexPath.section == 1 { cell.textLabel?.text = indexPath.row == 0 ? "Voice preferences and connection" : "Microphone permissions" }
        else { cell.textLabel?.text = "About KovaGPT and haptics" }
        cell.accessoryType = .disclosureIndicator
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        if indexPath.section == 0 { switchAccount?() }
        else if indexPath.section == 1 && indexPath.row == 0 { openVoiceSettings?() }
        else if indexPath.section == 1 {
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
        } else { showAbout?() }
    }
}
