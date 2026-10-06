# security-monitoring

Security logging and alerting for one project: what is recorded, where it is
kept, and what raises an alert.

Adapted from the module written for the wider Welo estate (landing zone, OH
platform, disease management), cut down to what this deployment can actually
monitor. The original assumes a Shared VPC, an external HTTPS load balancer,
Firestore and Identity Platform. This deployment is serverless Cloud Run with
none of those, so VPC flow logs, Cloud Armor and the IAP and database-egress
detections are not here. They belong in the estate-wide module, against projects
that have the things they watch.

That turns out to cost less than it sounds. On a small serverless deployment an
attack shows up on the control plane: someone changes IAM, creates a service
account key, opens a service or a bucket to the internet, reads a secret, or
turns the logging off. All of that is here and all of it works today.

## What it does

| | |
| --- | --- |
| **Audit logging** | Admin Activity (always on) plus Data Access for Storage, Secret Manager, IAM and KMS |
| **Routing** | A log sink to a dedicated `security-logs` bucket, 365 days, log analytics on |
| **Alerting** | 11 live detections across control plane, network and application, each with a runbook line in the alert itself |
| **Notification** | Email channels, plus any channel created outside Terraform (Slack) |

### Single ownership of audit config

This module is the only place `google_project_iam_audit_config` is declared for
the project, and it must stay that way. The resource is authoritative per
project *and* service: two resources covering one service overwrite each other
on every apply, and Terraform reports no conflict while they do it, so it shows
up as permanent drift rather than an error. If something needs a service
audited, add it to `data_access_audit_services` rather than declaring it
elsewhere. `tests/security_monitoring.tftest.hcl` asserts this.

## The detections

Each carries a layer, a severity, a runbook line, and a **status**. Status is
the honest part: `live` means a log source produces these entries today,
`awaiting instrumentation` means the detection is correct but nothing emits the
event yet. Only live detections are created, because an alert policy that cannot
fire reads as coverage on a dashboard and in an assessment response while
protecting nothing.

`terraform output security_detections` lists them with their status, which makes
it usable as evidence without overclaiming.

### Live today

| Key | Layer | Severity | Fires when |
| --- | --- | --- | --- |
| `project_iam_change` | control plane | ERROR | A project IAM policy is set. Project-level grants reach every tenant. |
| `service_account_key_created` | control plane | CRITICAL | A downloadable key is created. Nothing here needs one: CI federates, ingest signs through signBlob. |
| `run_public_invoker` | control plane | CRITICAL | A Cloud Run service is granted to `allUsers`, excluding those listed in `public_run_services`. |
| `bucket_made_public` | control plane | CRITICAL | A bucket is granted to `allUsers` or `allAuthenticatedUsers`. |
| `secret_read_by_person` | control plane | ERROR | A human (not a service account) reads a secret payload. |
| `audit_config_change` | control plane | CRITICAL | What is audited changes. A standard first step before doing something that would be logged. |
| `logging_tampering` | control plane | CRITICAL | A sink, bucket or log metric is deleted or changed. |
| `kms_key_destroyed` | control plane | CRITICAL | A key version is scheduled for destruction. 24 hours to restore it. |
| `firewall_change` | network | ERROR | A firewall rule appears. There is no VPC here, so this should never fire. |
| `network_change` | network | WARNING | A network, subnet or route appears. Same reasoning. |
| `http_401_403_spike` | application | WARNING | Cloud Run refuses more than `thresholds.http_401_403` requests in five minutes. |

`break_glass_activity` is added when `break_glass_principals` is set.

The two network detections are deliberately "should never fire" alarms. A
firewall rule in a project with no VPC is not a tuning problem; it is somebody
building something nobody asked for.

### Awaiting instrumentation

Off by default (`enable_application_event_detections`). These depend on services
emitting the structured events below, and most of them presuppose authentication
this platform does not yet have. Turn them on in the same change that starts
emitting the events.

`tenant_mismatch`, `mfa_removed`, `privileged_role_assigned`, `l5_data_export`,
`login_failure_spike`, `authz_denial_spike`.

## Application security event contract

Services write one JSON line per event to stdout. Cloud Run forwards it to Cloud
Logging as `jsonPayload`. Events carry identifiers and outcomes only: **never
names, health data or request bodies.**

```json
{
  "log_type": "security",
  "severity": "WARNING",
  "event_type": "authz.tenant_mismatch",
  "outcome": "denied",
  "tenant_id": "t_123",
  "actor_id": "identity-provider-subject-or-service-account",
  "actor_type": "user",
  "resource": "clinical/patients/abc",
  "classification": "L5",
  "source_ip": "203.0.113.10",
  "request_id": "trace id",
  "privileged": false
}
```

| `event_type` | Emit when | Alert |
| --- | --- | --- |
| `auth.login_failed` | A login fails | Spike |
| `auth.mfa_removed` | A factor is removed from an account | Every event |
| `identity.role_assigned` | A role is bound to a user; set `privileged: true` for admin and clinical roles | Every privileged event |
| `authz.denied` | A permission check fails | Spike |
| `authz.tenant_mismatch` | A request's tenant differs from the token's tenant | Every event |
| `data.export` | Any export or bulk download; set `classification` | Every L5 export |

Nothing in this repository emits these yet. The work is small once there is an
identity provider to emit them about, and it is blocked on the same gap.

## Cost

The two log sources that dominate a Logging bill, VPC flow logs and load
balancer logs, are not routed here because there is neither. What remains is
audit logs and refused requests, which at this deployment's volume sits inside
the 50 GiB monthly free tier.

Watch two things if that changes. Logging ingestion is USD 0.50/GiB beyond the
free tier, which is **per project and shared across every tenant in it**. And
storage in a log bucket beyond 30 days is USD 0.01/GiB/month, so 365-day
retention costs eleven extra months of storage on whatever volume arrives. See
`docs/run-cost-model.md`.

## Prove it works

Each should raise its alert within a few minutes. Keep the emails as evidence.

```bash
# A person reading a secret payload
gcloud secrets versions access latest --secret=<a-test-secret> --project=<project>

# A service account key, created then removed
gcloud iam service-accounts keys create /tmp/k.json --iam-account=<test-sa>@<project>.iam.gserviceaccount.com
gcloud iam service-accounts keys delete <key-id> --iam-account=<test-sa>@<project>.iam.gserviceaccount.com
rm /tmp/k.json

# A project IAM change
gcloud projects add-iam-policy-binding <project> --member=user:<you> --role=roles/browser
gcloud projects remove-iam-policy-binding <project> --member=user:<you> --role=roles/browser
```

Do not test `bucket_made_public` against a tenant bucket. They enforce public
access prevention, so the attempt is refused before it reaches the detection,
which is the correct outcome but tells you nothing about the alert.

## Before enabling `lock_log_bucket`

Locking is irreversible. A locked bucket cannot have its retention shortened and
cannot be deleted, which is exactly the point: it stops an attacker, or a
mistake, shortening the evidence window. Leave it false until retention is
agreed with the client, because the obligation runs the other way too.
