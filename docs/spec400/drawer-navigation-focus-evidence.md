# Mobile drawer destination focus (#362)

Source implementation, pending rendered acceptance.

## Behavior

- `Sidebar.tsx` creates a one-use focus intent only for ordinary same-tab mobile destination selection, including same-route Chat/New chat and routed profile/help destinations. Modified link clicks retain their normal browser behavior.
- `DrawerNavigationFocus.tsx` is a small root-mounted coordinator. It survives per-page Sidebar/AppShell unmount and subscribes to the installed router's `onRendered` event. It does not modify router configuration or ordinary navigation.
- Cross-route focus waits for the matching rendered destination and idle route. Same-href Chat/New chat waits for a React commit because the router does not emit `onRendered` for unchanged hrefs.
- One microtask after the commit-effect flush lets destination-owned focus finish first. There is no timer, animation-frame delay, polling or scroll fallback.
- Focus goes to a visible main heading, then the visible mobile page title, then the main region. Clipped/1px body duplicates are rejected. The mobile title is explicitly a level-one heading. No text input or textarea is automatically focused, so ordinary navigation does not summon the mobile keyboard.
- Focus uses `preventScroll`. A temporary `tabindex=-1` is removed on blur if the target did not already have one.
- A later pointer/keyboard action, moved focus, principal change, superseding navigation (even to the same destination), or root unmount invalidates the old intent. New modal focus and a destination's existing focus are never overridden.
- Only a navigation-owned drawer close suppresses old-trigger restoration. Ordinary Escape/backdrop/Close dismissal keeps its existing focus-return behavior. Settings section focus and modal ownership are preserved.

## Files

- `src/lib/drawer-navigation-focus.ts`: bounded controller, registration and visible-target selection.
- `src/components/DrawerNavigationFocus.tsx`: router/commit/principal/interaction adapter.
- `src/components/Sidebar.tsx`: navigation-specific intent and dismissal distinction.
- `src/components/MobileTopBar.tsx`: semantic visible destination-title target.
- `src/routes/__root.tsx`: one coordinator import and child mount.
- `tests/unit/drawer-navigation-focus.test.mjs`: deterministic event ordering and synthetic DOM focus tests.
- `tests/unit/settings-return-focus.test.mjs`: supplies `page: false` in the existing dialog fixture; the earlier fixture lacked the variable used by the existing `selectTab` implementation. No Settings source changed for this navigation patch.

## Verification

The combined focused command below passes 42/42 tests:

```
node --test tests/unit/drawer-navigation-focus.test.mjs \
  tests/unit/sidebar-chat-action-focus.test.mjs \
  tests/unit/sidebar-tablet-menu-contract.test.mjs \
  tests/unit/settings-return-focus.test.mjs \
  tests/unit/settings-local-reset-confirmation.test.mjs \
  tests/unit/settings-deletion-dialog-focus.test.mjs \
  tests/unit/principal-device-reset.test.mjs
```

New tests cover slow route, resolved-before-rendered ordering, same-route selection, same-path query change, stale/newer intents, principal/interaction invalidation, detached Sidebar, root unmount, visible/clipped targets, modal/Settings-owned focus, no input autofocus, and unchanged ordinary-dismissal source wiring. All cleanup operations are synthetic fixtures.

ESLint for the changed navigation source/test files, TypeScript, Prettier checks and diff checks pass. No application build, real browser navigation, live service call, reset, deployment or acceptance-ledger change was performed. Combined real-browser keyboard/touch focus behavior and mobile title geometry remain verification work.
