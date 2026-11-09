# KovaGPT Android native preview

Build with JDK 17, Android SDK 35, Gradle 8.9 and Android Gradle plugin 8.7.3:
`cd android-native && gradle :app:assembleDebug`

This native Android Activity has HTTPS-only site navigation, an explicit native
confirmation for outside HTTPS links, a document picker for attachments, the OS
share sheet for the current KovaGPT URL, and native Back navigation. It denies
unexpected SSL errors and unsupported media requests. Microphone/camera access
requires an exact trusted origin, an explicit native explanation, and Android
runtime permission approval. It has no JavaScript bridge, native secrets, or
broad storage permissions.

**Preview only:** third-party OAuth inside Android WebView may be blocked; a
standards-compliant external-browser OAuth return flow is required for release.
Native microphone/camera permission prompts are implemented, but real-time
Voice/camera functionality needs device and service acceptance. Document scanner,
widgets, app-store purchases, push notifications, native biometrics and background
media remain unimplemented.
No production signing or store submission is configured.

## Native Back dismissal

Android Back first asks the trusted Kova page to dismiss the visible mobile
navigation drawer or a modal/menu with Escape. Only a fixed JavaScript
expression is executed after an exact HTTPS origin check; remote pages cannot
send commands to the native application. If nothing is open, Back navigates
WebView history, or delegates to Android when there is no history. This behavior
requires touch/gesture and accessibility verification on physical Android
devices.
