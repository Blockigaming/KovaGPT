# Auth rehearsal strict database connection probe

This operator tool diagnoses the existing disposable Auth rehearsal runtime after the live receiver returned:

```text
HTTP_STATUS: 503
SAFE_RECEIVER_STATUS: database_connect_failed
DATABASE_STATE: 0|0
INGRESS_DISABLED
```

It is deliberately separate from the migration request. It does **not** call `/api/internal/auth-migration/rehearsal`, create or consume a nonce, enable ingress, create a revision, modify a secret, change a database setting, or write an Auth row.
