# Source-derived offline UI review

This harness bundles the actual React route and component source. It replaces authentication state and server reads with explicitly synthetic fixtures; it does not recreate the customer interface with independent HTML. Review controls sit outside the app iframe.

After a completed client build:

```sh
node scripts/review/build.mjs ../core-ui-review
node scripts/review/audit.mjs
```

`KOVA_REVIEW_CSS_DIR` can point to the completed client asset directory. `KOVA_CORE_REVIEW_OUTPUT` selects the audit output directory. The standalone HTML opens from `file://` without a server. The component CSP denies provider connections and fixture fetch never forwards requests.

The generated manifest hashes the source components, fixture inputs, compiled CSS, bundle and HTML. The audit writes fresh screenshots plus a hash allowlist. A successful UI audit does not certify live authentication, AI output, billing, provider integrations, physical camera or virtual keyboard behavior. Full document extraction workers are not bundled in the offline review. Mutating server actions reject explicitly; local UI preferences and drafts remain interactive.

The audit checks desktop/phone guest and synthetic Free/Plus/Pro states, dark/light themes, the core routes and account/legal pages, composer attachment controls, populated conversation controls, Settings navigation/switch containment, and shared narrow/tablet/landscape widths. Its JSON output is the source of truth for the current run's actual counts, failures and limitations. No old screenshots or test counts should be reused after source changes.
