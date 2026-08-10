# Conditional CA remediation for the disposable Auth rehearsal

This tooling is prepared only for the branch in which the strict in-container probe returns:

```text
CATEGORY=tls_trust
QUERY_OK=false
CA_CONFIGURED=no
```

It must not be used for DNS, network, network-ban, authentication, pooler, capacity, database-not-ready, unknown, or successful probe results. It never sends an Auth migration request.

## Inputs and reviewed certificate identity

The operator supplies the Supabase `prod-ca-2021.crt` file. The validator rejects every certificate except the reviewed Supabase root with:

```text
common name=Supabase Root 2021 CA
serial=6CBC4CA1DEB63F692D0A2024C67289C2D13D54F6
SHA-256 fingerprint=807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA
not after=April 26, 2031 10:56:53 GMT
```

The validation also requires one PEM block and no appended payload, a self-issued and self-verified certificate, critical `CA:TRUE`, certificate-sign and CRL-sign key usage, and at least 24 hours of remaining validity.

## Required explicit evidence

Before running the mutation script, the operator must export all four exact values from the reviewed strict-probe result:

```bash
export CONFIRMED_PROBE_CATEGORY=tls_trust
export CONFIRMED_PROBE_REVISION=ca-kovagpt-auth-rehearsal--0000006
export CONFIRMED_PROBE_CA_STATE=absent
export CONFIRMED_PROBE_DATABASE_STATE='0|0'
```

Any mismatch stops before Azure access.

## Mutation command

From the repository root:

```bash
bash scripts/azure/validate-supabase-root-2021-ca.sh /path/to/prod-ca-2021.crt

bash scripts/azure/apply-auth-rehearsal-database-ca.sh \
  /path/to/prod-ca-2021.crt
```

The script performs only these mutations, and only on `ca-kovagpt-auth-rehearsal`:

1. create Container Apps secret `auth-migration-rehearsal-database-ca` containing the validated public CA;
2. create a new revision that maps only that secret to `AUTH_MIGRATION_REHEARSAL_DATABASE_CA` while preserving the reviewed immutable image and `1/1` replica pinning.

It does not modify `ca-kovagpt-dev`, enable ingress, alter Supabase, change the database URL, change the bridge secret, add model-provider credentials, or call the migration route.

## Pre- and postconditions

The script fails closed unless it proves:

- subscription, tenant, resource group, and app are exact;
- latest and latest-ready revision are still `0000006` before mutation;
- the exact reviewed image digest is deployed;
- ingress is disabled;
- min/max replicas are `1/1`;
- generation kill switches are correct;
- destination is only `oztdrjtdglkizlewnulh`;
- database URL and bridge secret remain exact secret references;
- no CA environment entry or CA secret exists before mutation;
- no TLS-bypass/runtime override exists;
- no model-provider credential exists;
- database URL passes the receiver's disposable direct/session-pooler affinity rules;
- destination is `0|0` over an encrypted read-only count connection;
- exactly one baseline replica exists.

After mutation it validates the stored CA immediately, waits for a new ready revision, then retrieves and validates the stored CA again before rechecking the image, environment, secret reference, ingress, one replica, and `0|0` database state.

## Failure behavior

If any failure occurs after the CA secret is created, the script does not delete or overwrite it. It emits:

```text
PARTIAL_SAFE_STATE=CA_SECRET_MAY_EXIST
DO_NOT_RETRY_BLINDLY
```

The next operation is an Azure read-only state audit, not a rerun.

## Next gate after success

A successful CA deployment still does not authorize the migration request. Run the strict read-only in-container probe again against the exact new revision:

```bash
bash scripts/azure/run-auth-rehearsal-strict-db-probe.sh \
  ca-kovagpt-auth-rehearsal--<new-revision-suffix> \
  present
```

Only a reviewed `CATEGORY=success` and `QUERY_OK=true`, together with ingress disabled and database `0|0`, can open a separate decision on one fresh authenticated synthetic request.
