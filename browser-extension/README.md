# KovaGPT Tab Context extension

An optional Manifest V3 extension for desktop Chrome/Edge/Chromium. Open this folder as
an unpacked extension from the browser's extension developer mode. There is no automatic
installation or store publication. Safari and Firefox packaging are not included.

1. On an HTTPS website, open **KovaGPT Tab Context** from the extensions menu.
2. Optionally select **Include text I selected on this page**.
3. Click **Prepare preview**, review/edit the title, address and optional selected text.
4. Click **Copy context**, then open KovaGPT and paste it into the intended chat.

Every step is user-initiated. Opening the popup alone does not inspect the page. The
extension has no background script, persistent host permissions, content-script injection,
cloud calls, chat credentials, history access, cookie access or native messaging bridge.
`activeTab` limits page access to the tab on which the user opens the extension;
`scripting` reads only the selected text when requested; `clipboardWrite` permits the
explicit reviewed copy. A navigation invalidates a pending preparation. Other installed
apps can read copied clipboard text. Do not include secrets in context you choose to send.

Local tests cover source policy, restricted schemes, bounded selections, opt-in reading,
change-of-tab URL and popup interactions. Real browser extension installation, permission
revocation, and store review remain release acceptance gates. This does not connect the
website to arbitrary open browser tabs or expose a local command bridge.
