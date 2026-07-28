# Runbook: Welo inference & agent service

Operational guide for the service in `model/welo_inference`. Grows with each
production-readiness phase; this is the Phase 1 baseline.

## Health and readiness

- `GET /healthz` - process is up; `model_loaded` shows whether artifacts loaded.
- `GET /readyz` - returns 503 until the model is loaded. Use as the Cloud Run
  startup probe (already wired in Terraform).
- `GET /agents` - `available` true only when a real Anthropic key is present.
- `GET /metadata` - model version and metrics currently served.
- `GET /metrics` - per-agent tokens/cost/latency, per-route HTTP stats, scenario
  counters (key-protected). Logs are structured JSON with a `request_id` on every
  line; filter Cloud Logging by `request_id` to trace one request end to end.

## Deploy and roll back

Build and deploy are in [`../infra/README.md`](../infra/README.md).

- **Deploy:** build the image, `terraform apply -var-file=<env>.tfvars`.
- **Roll back:** re-deploy the previous image tag (Cloud Run keeps revisions;
  you can also shift traffic back to the prior revision in the console).
- **New model:** retrain offline, commit refreshed `models/` +
  `data/outputs/dashboard_feed.json`, rebuild the image, deploy.

## Common incidents

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Dashboard chips stuck on "Offline demo" | No key, or `/agents` returns available=false | Confirm the secret has a version; `enable_agents=true`; check startup log line |
| Agent calls 503 | Key missing/invalid, or Anthropic outage | Check `GET /agents` reason; verify the secret; check Anthropic status |
| Agent latency high / timeouts | Long generations or upstream slowness | `WELO_AGENT_TIMEOUT_S`, or set a cheaper `WELO_AGENT_MODEL` |
| `/scenario` returns 429 | Rate limit hit | Expected protection; raise `WELO_RATE_LIMIT_PER_MIN` if legitimate |
| `/scenario` 503 "Model not loaded" | Artifacts missing in the image | Check the image bakes `models/` and the feed; check startup logs |
| Cost spike | Heavy agent usage | The Anthropic spend cap is the backstop; review per-agent cost and call counts at `GET /metrics` |

## Key rotation

The Anthropic key lives only in Secret Manager, injected at runtime.

```bash
printf 'sk-ant-NEWKEY' | gcloud secrets versions add anthropic-api-key --data-file=-
# Cloud Run reads version "latest"; redeploy or send traffic to a new revision to pick it up
```

Never put the key in the image, the repo, or the browser. Revoke the old key in
the Anthropic console after rotating.

## Data governance (real personal data)

Every agent request passes through `governance.sanitize` (see
[`data-governance.md`](data-governance.md)): identifiers dropped, ids
pseudonymised, free-text PII redacted, prompt-injection neutralised. Before
go-live with real data, complete the checklist in that document, in particular:
set `WELO_PSEUDONYM_SALT` to a managed secret, set `WELO_REQUIRE_AUTH=1` with IAP
(or key), lock `WELO_CORS_ORIGINS`, and confirm the Anthropic DPA. Watch the
`governance` counters at `GET /metrics`; a sudden rise in `injection_flags` is
worth investigating.

## Guardrails to keep in mind

- The agents are grounded on supplied data only and are told the records are
  synthetic; the governance boundary enforces minimisation once real data flows.
- CORS should be locked to the dashboard origin in any non-demo deployment
  (`WELO_CORS_ORIGINS`).
- Public Cloud Run + spend cap is acceptable for the demo; internal Welo
  deployment should move to authenticated invocation.

## Contacts / escalation

To be completed on migration into Welo's environment (on-call, Anthropic account
owner, cloud project owner).
