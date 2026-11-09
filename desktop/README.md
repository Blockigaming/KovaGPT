# KovaGPT desktop preview

A real Electron desktop shell that displays https://kovagpt.com in its own native window. It uses the live website's interface and services; it is not a second UI implementation. Sign in inside the app. Browser cookies are not imported.

## Development

```sh
cd desktop
npm ci
npm test
npm start
npm run dist
```

The separate package does not change the web app's dependency tree. Electron, electron-builder and transitive dependencies are pinned in the lockfile. The Desktop app preview workflow builds Mac Apple Silicon, Mac Intel, Windows x64 and Linux x64 artifacts on PRs touching this directory. Preview builds are unsigned and are not automatically published. A ChromeOS device can install the existing web app from the browser; these native packages target macOS, Windows and Linux.

`kovagpt://open` launches or focuses the installed app. Protocol links cannot supply URLs, commands or authentication tokens. macOS registration comes from the package; NSIS/deb integrate the protocol. AppImage integration depends on the Linux desktop.

Remote renderers have sandboxing, context isolation and web security enabled, with no preload or Node integration. External HTTPS links require confirmation and open in the system browser; other schemes and cross-origin redirects are blocked. Camera, microphone and notifications require a native permission choice from the Kova main frame. Local files use the web app's existing user-initiated chooser.

## Release acceptance

Before public distribution, install the artifacts on each target OS and verify password sign-in, window persistence, `kovagpt://open`, attachment selection, drawing, voice permissions and sign-out. Google sign-in through a system browser needs a separately reviewed session handoff; embedded Google login is not certified. macOS needs Developer ID signing and notarization, Windows needs a trusted signing certificate, and the public download page should link only to a verified release. The local command runner executes only explicit, individually confirmed commands while its workspace is open. There is no scheduled background agent or native auto-updater in this preview. Updating the website updates its rendered UI; Electron security updates require a new package.

Official references: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [packaging](https://www.electronjs.org/docs/latest/tutorial/application-distribution), [protocol lifecycle](https://www.electronjs.org/docs/latest/api/app#event-open-url-macos), [electron-builder configuration](https://www.electron.build/configuration/).

## Companion window and installed-app settings

The **Companion → Open Companion Window** menu opens a separate floating,
resizable Electron window. The global shortcut defaults to Option+Space on
macOS and Alt+Space on Windows, with a safer Control+Shift+Space default on
Linux. If the OS reserves a combination, the app tries a fallback and lets the
user choose a reviewed alternative or disable the global shortcut in
**Companion → Keyboard shortcut**. Preferences contain only the shortcut
choice and are saved in the native app's user-data directory.

The companion uses the same isolated session and the same sandboxed remote
renderer. It has no preload, Node integration, OS shell command bridge or
privileged filesystem access. Kova-only navigation rules apply to both windows.

Packaged macOS and Windows apps include **Companion → Launch at login**.
It invokes the operating system's login-item API and verifies the result.
Unsigned/unpackaged previews and Linux do not claim automatic startup.
Installation tests must confirm the actual OS shortcut, window focus,
permission prompts and launch-item persistence before public distribution.

## macOS menu bar and Dock preferences

On macOS, **Companion → Show menu bar icon** creates a native Tray icon
with actions to open the main app, open the companion, or quit. The icon is
loaded from the packaged local Kova asset, never supplied by a web page.
**Companion → Show Dock icon** controls the system Dock appearance. The app
refuses to hide the Dock icon unless the menu bar icon is active, so both
entry points cannot be hidden simultaneously. The toggles are stored in
local preferences with the approved shortcut. The tray is destroyed on quit.
Physical Mac installation and menu bar/Dock verification remain required.

## Separate desktop chat windows

**File → New Window** (Command/Ctrl+N) creates another independently
resizable and closable native conversation window. Each window uses the same
signed-in Kova session but has its own renderer. Every window enforces the
exact Kova HTTPS navigation policy and sandbox / context isolation. External
HTTPS navigation is confirmed from the window that initiated it; file,
JavaScript and other dangerous protocols remain blocked. Camera, microphone
and notification choices are bound to the requesting native window. Closing
an additional window removes it from the permission allowlist.

Native preview build and physical installation acceptance are still required.

## Local file import (user-authorized)

**File → Copy local source file...** opens the operating system's file chooser.
Only a single selected nonempty text source file up to 256 KiB can be read.
A second native confirmation is required before the text is copied to the
system clipboard. Clipboard contents may be visible to other installed apps.
The file is never uploaded, submitted, or copied to the web renderer
automatically. Kova's remote website still has no Node, local filesystem,
shell or IPC bridge.

This separate clipboard action is intentionally limited. The dedicated offline
coding workspace described below handles folder browsing and text editing.
The workspace also includes the separately authorized terminal described below; neither surface provides a computer-control agent.

## Local coding workspace — private repository editor

**File → Open Local Coding Workspace** (Command/Ctrl+Shift+E) opens a separate
offline Electron window with a repository tree, source-code editor, change
preview, and explicit local save. The user must select a folder in a **native
folder chooser**. Nothing is indexed or read before this approval.

- The local renderer loads only `kova-local://workspace/index.html` and its
  packaged script. It has a restrictive Content Security Policy, no network
  connections, an independent Electron session, disabled permission grants,
  sandboxing, context isolation and no Node integration. It cannot navigate
  to `https://kovagpt.com` or open arbitrary windows.
- The limited preload API is attached **only** to this local window. Every
  privileged call requires the exact local main frame and originating
  webContents. No remote website window has this preload or IPC access.
- File browsing is restricted to the chosen canonical directory. Traversal,
  hidden paths, symbolic links, binaries, unsupported extensions, and files
  exceeding 512 KiB are rejected. Directory lists are bounded.
- A source file must be explicitly opened before it can be edited. A change
  preview shows its modified lines. **Saving requires a second native
  confirmation** and refuses to overwrite any file changed since opening.
  Files are replaced atomically; saving alone never executes or uploads them.
- Closing the workspace or folder clears the selected path and in-memory
  authorization; authorization is not synchronized to the website.

This includes a functional **local text repository explorer/editor, Git inspection and local command runner**. Real multi-platform installation,
keyboard accessibility, file locking, and signing/notarization acceptance remain
outstanding before public release. The remote web app remains unchanged.

## Local commands and source control

Within **File → Open Local Coding Workspace**, open a folder and expand **Local terminal**.
Enter a command and choose **Review and run…**. A native confirmation displays the exact
command and full working directory. Cancelling does not start a process. Commands run
under the installed user's OS permissions; the selected directory is a working directory,
not a sandbox. Commands can read or modify files outside it or access the network.
The remote site has no IPC channel to start commands, approve them, or read output.

- POSIX uses `/bin/sh -c`; Windows uses the system `cmd.exe /d /s /c`.
- Both output streams are displayed live, with exit code, failure, cancellation and timeout states.
- **Stop** terminates the process group on POSIX or process tree on Windows. Closing the
  workspace also stops its running command. Programs that detach from the process tree
  can outlive it; this is a local tool, not an OS containment boundary.
- Each command has a two-minute limit and a 256 KiB output limit. Input is closed;
  interactive prompts, PTY programs and persistent shell sessions are not supported.
- Runs and output stay in memory, limited to 30 entries. Clear history, close the folder,
  or close the window to discard them. No background schedule or cloud synchronization exists.
- Environment inheritance is restricted to OS execution, home and temporary-directory
  variables; application API credentials, Node injection flags and Git override variables
  are not passed to children. The user's own tools can still load their normal local config.
- Folder switching is blocked while a command is awaiting confirmation or running.
  Confirmation cannot be reused after navigation or a workspace identity change.

**Source control** shows actual Git status, working diff, staged diff and the last 20 commits.
Git must be installed and the selected folder must contain `.git`. These views use fixed,
read-only argument lists, disable external diff/textconv/fsmonitor, and enforce time/output
limits. Stage, commit, branch and other changes can be entered as individually confirmed
terminal commands. This is not an autonomous coding agent or browser-tab integration.

Validation includes actual temporary Git repositories and local processes, permission
rejection, cancellation, bounds, and renderer interaction tests. Signed OS installation,
Windows process-tree behavior and real-device acceptance remain release gates.
