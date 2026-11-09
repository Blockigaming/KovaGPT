# KovaGPT iOS native preview

Use Xcode 16+ and XcodeGen to generate the project:

```sh
cd ios-native
xcodegen generate
xcodebuild -project KovaGPT.xcodeproj -scheme KovaGPT \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

The real iOS app uses WKWebView with an exact KovaGPT HTTPS main-frame
navigation policy and no privileged JavaScript bridge. It has navigation,
a native share sheet, and a user-initiated VisionKit document scanner that
combines multiple scanned pages into a PDF. It **does not automatically send**
that PDF; users may save/share it and attach it to chat explicitly.

## Native Home Screen shortcut widget

The WidgetKit medium Home Screen widget has **New chat**, **Scan document**,
**Camera**, and **Photos** actions. The large widget additionally offers
**Voice** and **Dictate** shortcuts. Both use a registered `kovagpt://` scheme with a strict allowlist in
`KovaGPTApp.swift`: no arbitrary URL, host, query, fragment or shell command
is accepted. New chat opens the app home; Scan presents the existing VisionKit
scanner only after the app becomes visible. It never uploads a scan without an
explicit user share. The app extension must compile with the unsigned simulator
preview and still requires a signed iPhone installation for real-device testing.

Requirement 309 now has source implementations for all six shortcut
destinations. Camera and Photos open native pickers and prepare an explicit iOS
sharing sheet, not a silent chat attachment. Voice and Dictate open the actual
website composer controls after the trusted page loads and only where account
eligibility allows. Starting microphone capture remains an explicit in-app
action. No background microphone or screen capture is activated by the widget.
Unsigned iOS preview compilation and signed physical-device acceptance remain
mandatory before this requirement can be called completed.

This preview is not signed or distributed via the App Store. Embedded provider
OAuth may be restricted in WKWebView; production requires secure external
browser authentication and a verified callback. Dynamic Island, CarPlay,
background Voice, push, in-app purchases, biometric chat locks, and live-voice widgets are **not** implemented. The native app also needs testing on actual
iPhone and iPad hardware.
