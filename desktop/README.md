# KovaGPT desktop preview

A real Electron desktop shell that displays https://kovagpt.com in its own native window. It uses the live website's interface and services; it is not a second UI implementation. Sign in inside the app. Browser cookies are not imported.

## Development

```sh
cd desktop
npm install
npm test
npm start
npm run dist
```

The separate package does not change the web app's dependency tree. Electron and electron-builder are pinned. The Desktop app preview workflow builds Mac Apple Silicon, Mac Intel, Windows x64 and Linux x64 artifacts on PRs touching this directory. Preview builds are unsigned and are not automatically published. A ChromeOS device can install the existing web app from the browser; these native packages target macOS, Windows and Linux.

`kovagpt://open` launches or focuses the installed app. Protocol links cannot supply URLs, commands or authentication tokens. macOS registration comes from the package; NSIS/deb integrate the protocol. AppImage integration depends on the Linux desktop.

Remote renderers have sandboxing, context isolation and web security enabled, with no preload or Node integration. External HTTPS links require confirmation and open in the system browser; other schemes and cross-origin redirects are blocked. Camera, microphone and notifications require a native permission choice from the Kova main frame. Local files use the web app's existing user-initiated chooser.

## Release acceptance

Before public distribution, install the artifacts on each target OS and verify password sign-in, window persistence, `kovagpt://open`, attachment selection, drawing, voice permissions and sign-out. Google sign-in through a system browser needs a separately reviewed session handoff; embedded Google login is not certified. macOS needs Developer ID signing and notarization, Windows needs a trusted signing certificate, and the public download page should link only to a verified release. There is no native background execution or native auto-updater in this preview. Updating the website updates its rendered UI; Electron security updates require a new package.

Official references: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [packaging](https://www.electronjs.org/docs/latest/tutorial/application-distribution), [protocol lifecycle](https://www.electronjs.org/docs/latest/api/app#event-open-url-macos), [electron-builder configuration](https://www.electron.build/configuration/).
