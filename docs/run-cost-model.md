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

Infrastructure and model inference run about **USD 1,100 per tenant per year**
for a production tenant, or about **USD 150** for a scale-to-zero demo tenant.
This is small enough that it should never drive an architectural decision. The
decisions that matter are about effort and reuse.

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

| Line | Sizing | Per month |
| --- | --- | --- |
| Inference service | 1 vCPU / 1 GiB, kept warm | USD 15 to 40 |
| Platform service | 1 vCPU / 512 MiB, kept warm, if on Cloud Run | USD 12 to 30 |
| Ingest job | 2 vCPU / 2 GiB, minutes per run | under USD 1 |
| Landing and derived buckets | tens of MB | under USD 1 |
| Artifact Registry | inference image about 1.2 GB, platform about 200 MB | USD 0.50 to 2 |
| Secret Manager | 3 secrets plus access operations | about USD 0.20 |
| Cloud Logging, data access audit | within the 50 GiB project free tier at this volume | USD 0 to 30 |
| Egress | small payloads | USD 1 to 5 |
| **Total** | | **USD 35 to 110** |

Budget **USD 70 a month, USD 840 a year** for a production tenant.

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

## Totals

Per tenant per year, production:

| | USD |
| --- | --- |
| Google Cloud | 840 |
| Model inference | 240 |
| Tooling, allocated across two tenants | 850 |
| **Total** | **about 1,930** |

A demo tenant, scale to zero, no warm instances: **about USD 150 a year.**

Allocated tooling falls as tenants are added. At four tenants the per-tenant
total is closer to USD 1,500; at eight, closer to USD 1,300. The variable part,
cloud and inference at about USD 1,080, is what genuinely scales with each new
tenant.

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
