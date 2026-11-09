import SwiftUI
import WebKit
import VisionKit
import PDFKit

@main
struct KovaGPTApp: App {
    var body: some Scene {
        WindowGroup {
            NativeBrowser()
        }
    }
}

struct NativeBrowser: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UINavigationController {
        UINavigationController(rootViewController: BrowserController())
    }
    func updateUIViewController(_ controller: UINavigationController, context: Context) {}
}

/// Native iPhone/iPad viewer with no JavaScript bridge, automatic screen capture or
/// privileged WKScriptMessageHandler. All document scans remain local until shared.
final class BrowserController: UIViewController, WKNavigationDelegate,
                               VNDocumentCameraViewControllerDelegate {
    private var browser: WKWebView!

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
        if browser.canGoBack { browser.goBack() }
    }

    @objc private func sharePage() {
        guard let url = browser.url, isKova(url) else { return }
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

    @objc private func showAbout() {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString")
            as? String ?? "Unavailable"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion")
            as? String ?? "Unavailable"
        showMessage("Version \(version) (build \(build))")
    }

    @objc private func scanDocument() {
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
