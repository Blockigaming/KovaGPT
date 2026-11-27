// A native KovaGPT app shell adds this token to its user agent; the website
// then uses the phone-app presentation (data-kova-surface="app"). Tests that
// exercise that presentation run as the app shell. Everything else runs as the
// website, which keeps the desktop experience on every screen.
export const KOVA_APP_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/130.0.0.0 Mobile Safari/537.36 KovaGPTApp/1.0";
