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

/// Native iPhone/iPad viewer with no JavaScript bridge, automatic screen capture or
/// privileged WKScriptMessageHandler. All document scans remain local until shared.
final class BrowserController: UIViewController, WKNavigationDelegate,
                               VNDocumentCameraViewControllerDelegate,
                               UINavigationControllerDelegate,
                               UIImagePickerControllerDelegate,
                               PHPickerViewControllerDelegate {
    private var browser: WKWebView!
    private var lastShortcutID: UUID?
    private var pendingShortcut: NativeShortcut?

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
        switch action {
        case .newChat:
            browser.load(URLRequest(url: URL(string: "https://kovagpt.com/")!))
        case .scan:
            scanDocument()
        case .camera:
            takePhoto()
        case .photos:
            choosePhoto()
        }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "KovaGPT"
        view.backgroundColor = .systemBackground

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        browser = WKWebView(frame: .zero, configuration: config)
        browser.navigationDelegate = self
        browser.allowsBackForwardNavigationGestures = true
        browser.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(browser)
        NSLayoutConstraint.activate([
            browser.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            browser.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            browser.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            browser.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
        ])
        navigationItem.leftBarButtonItem = UIBarButtonItem(
            title: "Back", style: .plain, target: self, action: #selector(goBack)
        )
        navigationItem.rightBarButtonItems = [
            UIBarButtonItem(title: "Share", style: .plain, target: self,
                            action: #selector(sharePage)),
            UIBarButtonItem(title: "Scan", style: .plain, target: self,
                            action: #selector(scanDocument)),
            UIBarButtonItem(title: "About", style: .plain, target: self,
                            action: #selector(showAbout)),
        ]
        browser.load(URLRequest(url: URL(string: "https://kovagpt.com/")!))
    }

    private func isKova(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https" &&
        url.host?.lowercased() == "kovagpt.com" &&
        url.user == nil && url.password == nil &&
        (url.port == nil || url.port == 443)
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
        present(alert, animated: true)
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
