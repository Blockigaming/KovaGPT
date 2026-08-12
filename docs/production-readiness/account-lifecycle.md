# Account lifecycle validation

Export must describe its actual device/cloud scope and require authentication for cloud records. Deletion requires confirmation and, where supported, recent reauthentication. Validate subscription handling, connector and API-key revocation, scheduled-task disabling, share revocation, files/images/chats/projects/library/research cleanup, and documented retained audit records. Unknown IDs fail closed.

Do not claim immediate or complete deletion where backups, billing records, security logs, or provider retention remain. Those retention statements require legal review. Stop on orphaned public shares, active scheduled work, reusable credentials, or cross-user cleanup.
