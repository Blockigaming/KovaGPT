# KovaGPT Android native preview

Build with JDK 17, Android SDK 35, Gradle 8.9 and Android Gradle plugin 8.7.3:
`cd android-native && gradle :app:assembleDebug`

This native Android Activity has HTTPS-only site navigation, an explicit native
confirmation for outside HTTPS links, a document picker for attachments, the OS
share sheet for the current KovaGPT URL, and native Back navigation. It denies
unexpected SSL errors and all automatic renderer camera/microphone requests.
It has no JavaScript bridge, native secrets, or broad storage permissions.

**Preview only:** third-party OAuth inside Android WebView may be blocked; a
standards-compliant external-browser OAuth return flow is required for release.
Voice/camera permission flows, scanner, widgets, app-store purchases, push
notifications, native biometrics and background media remain unimplemented.
No production signing or store submission is configured.
