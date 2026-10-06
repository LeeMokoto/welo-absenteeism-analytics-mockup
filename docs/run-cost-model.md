# Run cost model

What it costs to run one tenant of this platform for a year, and which numbers
actually move.

Scope note: this covers infrastructure and model inference only. Engagement
economics (effort, rates, margin) are deliberately not in this repository.

Every figure here is derived from what is in the repository, with the
measurement shown, so you can re-derive it after a change rather than trusting a
number someone typed once. Cloud prices move and vary by region: treat the GCP
ranges as sizing guidance and confirm against the pricing calculator for the
region a tenant actually runs in.

## The one-line answer

Running the platform at all costs about **USD 720 a year** in fixed cost, and
each additional tenant adds about **USD 350 a year**. The current demo
deployment, with nothing kept warm, is about **USD 340 a year** all in. A single
production tenant with every optional line switched on is about **USD 2,630**.

The two largest lines in that figure are a GitHub licence and Vercel seats, not
Google Cloud. All of it is small enough that it should never drive an
architectural decision. The decisions that matter are about effort and reuse.

## Model inference

### Measured inputs

| Input | Value | How measured |
| --- | --- | --- |
| Shared guardrails block | 1,113 chars | `model/welo_inference/agent_prompts.json` |
| Per-agent role prompt | 316 to 456 chars | same file, three absence agents |
| System prompt total | 1,429 to 1,569 chars, about 390 tokens | guardrails plus role |
| Grounding payload | 260 to 405 chars in the eval cases; budget 1,200 chars on screen | `welo_inference/evals/cases.py` |
| Output cap | 1,500 tokens absence, 1,200 sick leave | `MAX_TOKENS` in both routes |
| Typical answer | about 500 tokens | grounded answers are short by design |

Working figure: **about 700 input tokens and 500 output tokens per answer.**

### Cost per answer

At current list prices:

| Model | Input | Output | Cost per answer |
| --- | --- | --- | --- |
| Opus 5.5 | USD 4 / MTok | USD 20 / MTok | USD 0.0128 |
| Sonnet 5.5 | USD 2 / MTok | USD 10 / MTok | USD 0.0064 |
| Haiku 4.5 | USD 1 / MTok | USD 5 / MTok | USD 0.0032 |

**About one US cent per agent answer.** Round numbers are fine here; nothing
downstream is sensitive to the second decimal.

### Monthly cost by usage

| Scenario | Answers per month | Cost per month |
| --- | --- | --- |
| Pilot: 15 users, 3 answers a week | about 195 | USD 2 |
| Production: 40 users, 2 answers a working day | about 1,760 | USD 18 |
| Heavy: 80 users, 6 answers a working day | about 10,560 | USD 106 |

Budget **USD 20 a month, USD 240 a year** for a production tenant.

### The eval gate costs about the same as a tenant

Six golden cases run live on every CI run where a key is configured. At 150 runs
a month that is 900 calls, roughly **USD 9 a month**. The guardrail gate costs
about half of what a real tenant's users cost. That is worth knowing and worth
keeping: it is the only check that the guardrails hold in actual output.

### The expensive mistake, not made

The agents are grounded on the figures already on screen, sent by the browser,
not on the feed. The feed is 1,701,508 bytes, roughly **425,000 tokens**. Sending
it as context would cost about **USD 1.70 per call** on Opus 5.5 against USD
0.0128 today: a **130x** increase, turning a USD 240 a year line into about USD
36,000 at production volume.

If a future screen does need to reason over something large, use prompt caching
before anything else. Cache reads are USD 0.20/MTok against USD 4 for Opus 5.5,
a 20x reduction on anything repeated between calls.

### Two levers worth pulling

**The configured models are a generation behind, and the current ones are
cheaper.** `agent_model` defaults to `claude-opus-4-8` and
`sick_leave_agent_model` to `claude-sonnet-5`. Opus 5.5 lists at USD 4/20 against
USD 5/25 for Opus 4.8: about 20% cheaper and more capable. Refreshing both
defaults lowers cost and raises quality at once.

**Haiku may be enough for the analyst agent.** It summarises figures already
computed and on screen. Haiku 4.5 is a quarter the cost of Opus 5.5 per answer.
Whether quality holds is an empirical question and there is already a harness to
answer it: run `python -m welo_inference.evals` with the model switched and
compare.

## Google Cloud, per tenant

Fourteen resources per tenant (`infra/terraform/modules/tenant`), plus a share of
the project-level services.

The split matters, and it is not where you would guess from the diagram. Only
fourteen resources are inside `modules/tenant`. The inference service, the
Artifact Registry, the Anthropic key secret, the static dashboard bucket and the
CI identity are all declared at the root, which means **one per deployment,
shared by every tenant in it**. The expensive always-warm container is on the
shared side, so the marginal tenant is cheaper than the first.

### Shared, once per deployment

| Line | Sizing | Per month | Per year |
| --- | --- | --- | --- |
| Inference service | 1 vCPU / 1 GiB, kept warm | USD 15 to 40 | USD 180 to 480 |
| Artifact Registry | inference image about 1.2 GB, platform about 200 MB | USD 0.50 to 2 | USD 6 to 24 |
| Anthropic key secret | 1 secret plus access operations | USD 0.06 | USD 1 |
| Static dashboard bucket | optional, `host_dashboard` | USD 0.20 | USD 2 |
| Terraform state bucket | versioned, 30 versions | USD 0.10 | USD 1 |
| Cloud Logging above the free tier | shared 50 GiB across the project | USD 0 to 20 | USD 0 to 240 |
| Security log bucket | audit logs and refused requests, 365 days | under USD 1 | under USD 12 |
| **Shared total** | | **USD 16 to 62** | **USD 190 to 750** |

Budget **USD 470 a year** for the shared layer. The sick-leave Cloud Run service
would add USD 144 to 360 a year, but `deploy_sick_leave` is false: it runs on
Vercel.

### Per tenant

| Line | Sizing | Per month | Per year |
| --- | --- | --- | --- |
| Platform service | 1 vCPU / 512 MiB, warm, only if `deploy_platform` | USD 12 to 30 | USD 144 to 360 |
| Ingest job | 2 vCPU / 2 GiB, minutes per run | under USD 1 | under USD 12 |
| Landing and derived buckets | tens of MB | under USD 1 | under USD 12 |
| Pseudonymisation key secret | 1 secret | USD 0.06 | USD 1 |
| Egress | small payloads | USD 1 to 5 | USD 12 to 60 |
| Attributable audit log volume | | USD 0 to 10 | USD 0 to 120 |
| **Per tenant, platform on Cloud Run** | | **USD 14 to 47** | **USD 170 to 565** |
| **Per tenant, platform on Vercel** | | **USD 2 to 17** | **USD 25 to 205** |

Budget **USD 360 a year** on Cloud Run, or **USD 110 a year** on Vercel, where
the seat cost moves to the tooling table instead.

Two things set the floor:

**Keeping instances warm is most of the bill.** `min_instances` defaults to 0,
which is right for a demo and wrong for a client: the inference container loads
scikit-learn and SHAP, so a cold start is several seconds on the first request
after an idle period. One warm instance of each service is roughly USD 30 to 70
a month, and it buys the difference between a demo that feels slow and one that
does not. A scale-to-zero demo tenant runs at about **USD 5 to 10 a month**.

**The audit logging line is the one that can surprise.** Cloud Storage and Secret
Manager data access logs are enabled by default
(`enable_data_access_logs`). Generation is free, ingestion is not, and the 50 GiB
free tier is **per project, not per tenant**, so it is shared across every tenant
in one project. At current volumes this stays free; at scale, narrow the services
rather than turning the control off.

**There is no GPU anywhere, and none is needed.** The models are scikit-learn on
tabular data: 6,000 rows today, and a real two-year extract at perhaps 100,000
rows still trains in minutes on a laptop. Worth stating explicitly, because
clients often assume machine learning implies GPU spend. It does not here.

## Worked example: one client tenant in africa-south1

The figures above assume a tier 1 region. A South African client wanting
in-country residency means `africa-south1` (Johannesburg), which is **tier 2**:
USD 0.0000336 per vCPU-second and USD 0.0000035 per GiB-second, a **40 percent
premium** on both against tier 1. On these volumes that is roughly USD 120 a
year across the whole deployment. Residency is cheap here, and this should not
be the reason to put the data anywhere else.

A month is 2,628,000 seconds. A warm instance with `cpu_idle = true` is billed
for its idle CPU at the reduced rate:

| Resource | Per month | Per year |
| --- | --- | --- |
| Platform service, 1 vCPU / 512 MiB, warm | USD 13.80 | USD 166 |
| Ingest job, monthly run of a few minutes | under USD 0.10 | about USD 1 |
| Landing and derived buckets, under 1 GB | under USD 0.05 | under USD 1 |
| Pseudonymisation key secret | USD 0.06 | USD 1 |
| Egress, about 40 users in region | USD 1 to 3 | USD 12 to 36 |
| Audit logs | within free tier | USD 0 |
| **Tenant total** | **about USD 16** | **about USD 200** |

If that client has its own project rather than being a tenant in Welo's, it also
carries the shared layer: the inference service at USD 18.40 a month (USD 221 a
year), Artifact Registry at about USD 6 a year, two secrets and a state bucket
at about USD 2, less a one-off free tier credit of about USD 23. That is **about
USD 206 a year**, so a client in its own project is **about USD 405 a year** in
Google Cloud, all in.

### What security monitoring adds, and what it deliberately does not

`modules/security-monitoring` routes audit logs and refused Cloud Run requests
to a dedicated 365-day bucket. At this deployment's volume that stays inside the
50 GiB monthly free tier, so it costs cents.

The two sources that would change that are not routed, because this deployment
has neither: VPC flow logs and load balancer logs. The estate-wide module the
cut-down one is adapted from carries both, and on a project that has them they
plausibly run to USD 900 to 1,500 a year, which is more than everything else on
this page put together. If this deployment ever grows a VPC or a load balancer,
revisit the sampling rate before enabling them, and remember the 50 GiB free
tier is **per project and shared across every tenant in it**.

### `cpu_idle` is worth more than everything else on this page

All three services set `cpu_idle = true`. Flipping it to false bills the warm
instance for CPU at the full active rate for every second it exists:

| | Per month | Per year |
| --- | --- | --- |
| 1 vCPU / 1 GiB warm, `cpu_idle = true` | USD 18.40 | USD 221 |
| the same with `cpu_idle = false` | USD 97.50 | USD 1,170 |

**A 5.3x difference from one boolean**, and more than the entire rest of the
Google Cloud bill. It is the only infrastructure setting here worth guarding.

### The cost is flat in headcount

The canonical extract is 146 bytes per employee per monthly file, measured from
`synthetic_upload_extract.csv` at 846 KB for 5,800 rows. A two-year backfill is
24 files:

| Workforce | Two-year backfill | Storage cost |
| --- | --- | --- |
| 5,800 | 20 MB | under USD 1 a year |
| 30,000 | 105 MB | under USD 1 a year |

Serving cost is driven by how many HR and occupational health users log in, not
by how many employees are covered, and that number does not scale with the
workforce. Training is scikit-learn on tabular data and stays in minutes.

So Google Cloud cost is **essentially flat in the number of covered lives**. If
a contract is priced per covered life, infrastructure margin improves with every
employee added. The cost drivers are the number of tenants and whether instances
are kept warm.

### Two things to confirm with the client

**The uploaded source files do not persist.** `raw_retention_days` is 30, so a
two-year backfill is deleted from the landing bucket 30 days after upload. That
is deliberate, because it is the only copy carrying the employer's own
identifiers, and the derived artifacts persist for 730 days. It should still be
stated in the data agreement rather than discovered.

**The model call leaves the country even when the data does not.** Claude is not
served from `africa-south1`, so the agent request goes to whichever region or
API endpoint is configured while everything else stays in Johannesburg. That has
no cost impact and a real contractual one under POPIA section 72. See
`docs/data-governance.md`.

## Tooling, fixed rather than per tenant

These are platform costs, so they divide across tenants rather than multiplying.

| Line | Cost | Notes |
| --- | --- | --- |
| GitHub Team | USD 4 per user per month | |
| GitHub Code Security | **USD 30 per active committer per month** | Required for the SARIF uploads to the security tab on a private repository. See below. |
| Vercel Pro | USD 20 per member per month | Only while the platform runs there |
| gitleaks-action licence | Free, but required | Free for a personal account. An **organisation-owned** repository needs a `GITLEAKS_LICENSE` secret or the secret-scan job fails. |

### The licensing dependency the pipeline introduced

The `iac-scan` and `containers` jobs upload SARIF to the repository's security
tab. On a **private** repository that requires a GitHub Code Security licence at
USD 30 per active committer per month: for three committers, about **USD 1,080 a
year**, which is more than the entire cloud and inference bill for one tenant.

It is avoidable. The findings themselves cost nothing to produce. Three options:

1. **Keep it.** Findings land in the security tab with history, triage and
   dismissal workflow. Worth the money if a client's security team will ask to
   see it.
2. **Drop the upload.** Fail the job on findings and attach the SARIF as a
   workflow artifact. Same gate, no licence, no history or triage UI.
3. **Make the repository public.** Code scanning is free on public
   repositories. Not appropriate once it holds client-specific configuration.

This is a commercial decision, not a technical one, which is why it is written
down rather than decided here.

### The one that will break on a move

`gitleaks-action` is free for a personal account and requires a licence key for
an organisation-owned repository. This repository currently sits under a personal
account, so the secret-scan job passes today. **Moving it to a Welo or
Cloudsmiths organisation will fail that job** until a free key is obtained from
gitleaks.io and set as `GITLEAKS_LICENSE`, or the job is switched to running the
MIT-licensed gitleaks binary directly. Worth doing before the move, not after.

## Annual totals

Four scenarios, all in USD per year. "Fixed" is the shared layer and the
tooling; "variable" is what each new tenant adds.

| | Demo only | 1 tenant, Vercel | 1 tenant, Cloud Run | 4 tenants, Vercel |
| --- | --- | --- | --- | --- |
| Shared Google Cloud | 40 | 470 | 470 | 470 |
| Per-tenant Google Cloud | 25 | 110 | 360 | 440 |
| Tenant model inference | 24 | 240 | 240 | 960 |
| CI guardrail evals | 108 | 108 | 108 | 108 |
| GitHub Team, 3 users | 144 | 144 | 144 | 144 |
| GitHub Code Security, 3 committers | 0 | 1,080 | 1,080 | 1,080 |
| Vercel Pro | 0 | 480 | 0 | 960 |
| **Total** | **about 340** | **about 2,630** | **about 2,400** | **about 4,160** |
| **Per tenant** | 340 | 2,630 | 2,400 | **about 1,040** |

Two figures to carry around:

**Fixed cost of running the platform at all: about USD 720 a year.** Shared
cloud (470), the eval gate (108) and three GitHub Team seats (144). Incurred
whether there is one tenant or ten.

Two optional lines sit on top of it and both are larger than the cloud bill:
the Code Security licence adds **USD 1,080 a year** for three committers,
taking fixed cost to about USD 1,800, and Vercel Pro adds **USD 240 per member
per year**.

**Marginal cost of the next tenant: about USD 350 a year** on Vercel, or about
USD 600 on Cloud Run, plus a Vercel seat if one is needed. That is the number
that matters for pricing: per-tenant infrastructure and inference are a rounding
error against the effort to onboard, so what a tenant costs to serve is set
almost entirely by the support model, not by the cloud.

The demo column is what the current deployment costs: no warm instances, no
Code Security licence, no Vercel Pro seats.

## What this means

The run cost is small enough that it should not drive design. Instance sizing,
region choice and model choice are worth getting right for latency, residency and
quality; they are not worth optimising for cost at this scale. Two decisions do
carry real money, and both are already made correctly:

- Grounding the agents on screen figures rather than the feed: a 130x difference.
- Not needing a GPU: the difference between a four-figure and a five-figure
  annual infrastructure bill.

The third decision carrying real money is the GitHub Code Security licence, and
that one is still open.

## Sources

- [Claude API pricing](https://claude.com/pricing)
- [GitHub Advanced Security license billing](https://docs.github.com/en/billing/concepts/product-billing/github-advanced-security)
- [Introducing GitHub Secret Protection and GitHub Code Security](https://github.blog/changelog/2025-03-04-introducing-github-secret-protection-and-github-code-security/)
- [About code scanning](https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning)
- [gitleaks-action](https://github.com/gitleaks/gitleaks-action)
