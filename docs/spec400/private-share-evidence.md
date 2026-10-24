# Private snapshot review

Requirements385–387 reuse the existing recipient-scoped frozen-snapshot contract. The focused preview component/helper/tests from the separately preserved00ae00a source were individually reviewed and adapted to the current spec geometry; no other later redesign was imported.

- Exact included user/assistant text is captured before a separate final Share action.
- Recipient/title are visible; attachments, tools, private metadata and other branches are excluded.
- Later private edits cannot mutate the captured payload.
- Missing accounts, changed principal/chat/lifetime, unmount and stale completions fail closed.
  -10 focused tests pass. No real share or recipient lookup was performed.
- The existing Library manager remains the actual shared-snapshot/revoke destination. No public link or new ACL was added.
- Current-candidate rendered review remains pending, including short phone scrolling and Light primary keyboard contrast.
