# Auth rehearsal: next read-only Azure checks

The Azure CLI was not available in the 2026-08-12 local release run. Do not enable ingress or invoke the migration receiver until database connectivity is independently proven. Run these commands from an authenticated operator shell; they read control-plane/runtime state and never print secret values.

```bash
az account show --query '{subscription:id,tenant:tenantId,user:user.name}' -o json
az containerapp show -g rg-kovagpt-dev -n ca-kovagpt-auth-rehearsal \
  --query '{state:properties.runningStatus,latestRevision:properties.latestRevisionName,latestReady:properties.latestReadyRevisionName,ingress:properties.configuration.ingress.externalFqdn,image:properties.template.containers[0].image,replicas:properties.template.scale}' -o json
az containerapp revision list -g rg-kovagpt-dev -n ca-kovagpt-auth-rehearsal \
  --query '[].{name:name,active:properties.active,replicas:properties.replicas,runningState:properties.runningState,created:properties.createdTime}' -o table
az containerapp show -g rg-kovagpt-dev -n ca-kovagpt-auth-rehearsal \
  --query 'properties.template.containers[0].env[].name' -o tsv | sort
az containerapp logs show -g rg-kovagpt-dev -n ca-kovagpt-auth-rehearsal \
  --revision ca-kovagpt-auth-rehearsal--0000006 --tail 100 --format text
```

Before any receiver request, use the platform's approved exec path to perform only DNS/TCP reachability and a read-only `select current_database(), current_user` with credentials already injected into the container. Do not echo connection strings, tokens, or passwords. Reconfirm the destination project's migration tables remain unchanged and ingress remains disabled. Any mutation requires a separately reviewed migration plan, backup/rollback evidence, and explicit operator approval.
