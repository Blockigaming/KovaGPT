# Project details: confirmed owner update

The existing projects UPDATE policy is owner-only. The Context instructions editor now reflects that existing permission instead of offering editors an operation the policy silently filters. No policy, grant or migration is changed.

The update function retains user-authenticated Supabase/RLS, explicitly filters the current owner and requests the changed row identity. An error, missing row or mismatched identity cannot return success. The UI's existing failure path preserves the draft.

Five focused local tests cover matching owner-scoped success, database failure, no affected row, wrong row identity and the Context edit gate. Existing Cancel/focus tests remain passing. This proves source/mock behavior, not live database execution or a complete project-role matrix.
