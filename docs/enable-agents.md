# Turning the agents on

Four agent surfaces ship in this platform. Without a key they all answer from
the figures on screen by arithmetic, labelled as such; with a key they call the
model. Nothing else changes, and no code change is needed to switch over.

| Surface | Route | Model variable | Default |
| --- | --- | --- | --- |
| Portfolio Analyst, Case Assistant, Cover Coordinator | `/api/sick-leave/agent` | `SICK_LEAVE_AGENT_MODEL` | `claude-sonnet-5-5` |
| Absenteeism agents (streamed) | `/api/absenteeism/agents/{agent}/stream` | `WELO_AGENT_MODEL` | `claude-opus-5-5` |
| Playbook drafter | `/api/control-centre/playbooks/draft` | `WELO_AGENT_MODEL` | `claude-opus-5-5` |
| Python inference service | `POST /agents/{agent}` | `WELO_AGENT_MODEL` | `claude-opus-5-5` |

All four read `ANTHROPIC_API_KEY` server side. It is never sent to a browser,
never written into a build artifact and never committed. If one has been pasted
anywhere it should not be, rotate it in the Anthropic console rather than
deleting the message.

## Where the key goes

**Local.** Export it in the shell that runs the server. Not in `.env` committed
to the repository, and not in `next.config.mjs`.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run dev
```

**Vercel.** Project settings, Environment Variables, `ANTHROPIC_API_KEY`,
scoped to the environments that should have it. It has to be a server-side
variable: a name beginning `NEXT_PUBLIC_` is compiled into the browser bundle,
which for a credential means publishing it. Redeploy after adding it, because
Vercel reads environment variables at build and boot.

Set `WELO_MODULE_CONTROL_CENTRE` only if you want to override the default;
the control centre is on for a synthetic tenant without it.

**GCP.** The key lives in Secret Manager and the runtime reads it as a mounted
secret, so it never appears in Terraform state or in a container image.

```bash
# Add the value out of band. Piped on stdin, never as an argument: an argument
# is visible in the process list and in the shell history.
printf '%s' 'sk-ant-...' | gcloud secrets versions add welo-anthropic-key \
  --data-file=- --project absenteeism-demo
```

Then set `enable_agents = true` in the tfvars and apply. `create_secret_version`
stays `false`: letting Terraform write the value would put it in state.

On the `vertex` provider there is no key at all. The runtime authenticates as
its own service account, `vertex_region` decides where inference happens, and
that choice is a compliance statement rather than a preference. See
`docs/design-alignment.md`.

## Confirming it took

The sick-leave route has a config probe that reports whether a key is present
and which model is configured, and never returns the key or any part of it.

```bash
curl -s -b cookies.txt http://localhost:3000/api/sick-leave/agent | jq
curl -s -b cookies.txt 'http://localhost:3000/api/sick-leave/agent?models=1' | jq
```

`?models=1` lists the model ids the account can actually use and says whether
the configured one is among them. That is the fastest way to tell a rejected
key from a model the account cannot reach, which are the two failures that look
alike. It consumes no tokens.

A session needs the `use.agents` permission to call either, so sign in first;
the probe is not open.

## How to tell a real answer from a summary

Every response carries `source`. `model` means the model answered. `summary`
means no key is configured and the dashboard summarised the figures on screen,
and the answer itself opens by saying so.

The playbook drafter records `drafted_with` on the record it produces:
`agent` or `template`. It stays on the record permanently, so a plan filed six
months ago can still be read for how it was produced.

CI asserts the direction that matters: with a key configured, neither the
sick-leave agent nor the drafter may return a summary or a template. The
fallback exists so the demo works without a secret, and it must never quietly
become the product.

## Cost, roughly

Rates confirmed against Anthropic's published pricing. Per answer, on
groundings of a few KB:

| Model | Input | Output |
| --- | --- | --- |
| `claude-opus-5-5` | USD 4 / MTok | USD 20 / MTok |
| `claude-sonnet-5-5` | USD 2 / MTok | USD 10 / MTok |
| `claude-haiku-5-5` | USD 0.10 / MTok | USD 0.50 / MTok |

The system prompt is marked cacheable on every route, so a repeated call pays
USD 0.20/MTok on the cached prefix instead of the input rate. The grounding is
what varies and it is small.

`docs/run-cost-model.md` has the annual picture. The short version is that the
agents are not the expensive part of this platform at demo volumes.

## The evals

`model/welo_inference/evals` holds golden cases with the guardrail assertions,
including adversarial ones that check an agent refuses disciplinary use. They
need a key and have not been run against the current models.

```bash
cd model && ANTHROPIC_API_KEY=sk-ant-... python -m welo_inference.evals
```

Worth running once the key is in place, before showing the agents to anybody:
it is the only check that exercises what the model actually says rather than
what the route does with it.
