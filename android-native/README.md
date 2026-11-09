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

## Two saved accounts and visible native settings

The native top bar includes **App settings and accounts**, including account switching,
Voice settings, sharing, About and haptics. A real popup anchor makes these controls usable
with the existing NoActionBar theme and on phones without a physical menu button.

On Android 9/API 28 and later, **Switch to Account 1/2** switches between two persistent,
independent WebView profiles. The first retains the existing default WebView directory.
`SecondAccountActivity` is an internal, non-exported activity in `:accountTwo`;
`KovaApplication` sets `WebView.setDataDirectorySuffix("account-two")` in that process
before any WebView API is used. No URL, credentials, cookies, files or chat payloads are
passed between activities. Each account is signed in separately and keeps its own
cookies/local storage. Reordering activities preserves their in-memory composer state;
process eviction still relies on normal per-profile web draft persistence.

Android 8 retains the original single-account mode. Switching is blocked during Voice,
Dictation, file selection or a pending media permission request. The first-party DOM check
fails closed. Native lifecycle pause/resume is forwarded to each WebView.

**Voice settings** opens the existing account-scoped voice connection/preferences page or
the Android application permission settings. These actions never grant a permission or
start a recording automatically. Authentication and model/voice eligibility remain server-enforced.

The Android preview build checks the native classes/manifest. Real-device acceptance must
verify two different sign-ins, independent sign-out, drafts/attachments across switches,
permission cancellation, process restoration and media suspension. No native app-store
billing, background voice or signed-store release is implied.

Reference: [Android WebView process data directories](<https://developer.android.com/reference/android/webkit/WebView#setDataDirectorySuffix(java.lang.String)>).
