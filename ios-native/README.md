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

This preview is not signed or distributed via the App Store. Embedded provider
OAuth may be restricted in WKWebView; production requires secure external
browser authentication and a verified callback. Dynamic Island, CarPlay,
background Voice, push, in-app purchases, biometric chat locks, and iOS
widgets are **not** implemented. The native app also needs testing on actual
iPhone and iPad hardware.
