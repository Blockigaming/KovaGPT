# Finish the UI restore (required once)

`apps.tsx` and `ChatMessage.tsx` are stubs on this branch because large-file API pushes truncate (~4KB limit).

## Fastest path (30 seconds)

```bash
git checkout ui/apps-working-health-thinking
git pull
python3 scripts/apply-ui-fixes.py
git add src/routes/apps.tsx src/components/ChatMessage.tsx src/lib/connectors-catalog.ts
git commit -m "fix: restore apps/ChatMessage with Plaid, logos, Working for Ns, no Skip"
git push
```

`apply-ui-fixes.py` downloads clean copies from `main` and applies:
- Plaid in WORKING_IDS (not Coming soon)
- Favicon logos for every plugin
- Working-first sort
- ChatMessage uses StreamingStatus (Working for Ns, no Skip)
- Plaid catalog status setup_required

Already on this branch: StreamingStatus.tsx, ConversationHeaderActions, activity logos CSS.
