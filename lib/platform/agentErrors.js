/*
  Turning an upstream agent failure into something an operator can act on.

  This lived inside the sick-leave route, which meant the other two agent
  routes reported "the request failed" and nothing else. An operator reading
  that cannot tell an exhausted credit balance from a wrong model id from a
  rejected key, and those have three different fixes. The agents are the part
  of this product that is hardest to explain and most expensive to have down,
  so a failure should name its remedy on whichever route it happened.

  These messages are shown in the interface, so they name the likely fix and
  never include a credential. `redact` runs over anything taken from an SDK
  error, because an error can echo request context.
*/

// Never echo anything key-shaped back to the browser or into a log line.
export function redact(s) {
  return String(s || "").replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-[REDACTED]");
}

/*
  `modelEnvVar` is named in the message because the two deployments read
  different variables, and telling somebody to "set the model" without saying
  which variable is half an instruction.
*/
export function explainAgentFailure(status, err, { model, modelEnvVar = "WELO_AGENT_MODEL" } = {}) {
  const detail = redact(err?.error?.error?.message || "");

  switch (Number(status)) {
    case 401:
      return "The Anthropic API key was rejected. Check the key configured for this deployment.";
    case 403:
      return "The Anthropic API key is not permitted to make this request. Check the key's permissions.";
    case 404:
      return `The model "${model}" is not available to this account. Set ${modelEnvVar} to a model the account can use, then redeploy.`;
    case 400: {
      // The key authenticated, since that would be a 401, so the request
      // itself was rejected. The two common causes are an exhausted credit
      // balance and a model id the account cannot use, and both arrive as 400.
      if (/credit balance|too low|billing/i.test(detail)) {
        return "The Anthropic account has insufficient credit. Top up or raise the spend cap in the Anthropic console, then try again.";
      }
      if (/model/i.test(detail)) {
        return `The model "${model}" was rejected. Set ${modelEnvVar} to a model this account can use, then redeploy. Upstream said: ${detail}`;
      }
      if (/thinking|budget_tokens/i.test(detail)) {
        // Worth its own branch: budget_tokens was how extended thinking used
        // to be requested and is rejected on the current model family, so a
        // half-finished upgrade lands here and the message should say so.
        return `The thinking configuration was rejected for "${model}". This code requests adaptive thinking; a model that predates it, or a leftover budget_tokens, produces this. Upstream said: ${detail}`;
      }
      return `The request was rejected as invalid. Upstream said: ${detail || "no detail returned"}`;
    }
    case 429:
      return "Rate limited by the Anthropic API, or the account is out of credit. Wait a moment, or check the billing and spend cap.";
    case 500:
    case 502:
    case 503:
    case 529:
      return "The Anthropic API is temporarily unavailable. Try again in a moment.";
    default:
      return `The agent request did not complete${status ? ` (status ${status})` : ""}. The reason is in the server logs.`;
  }
}

/*
  One log line per failure, with the credential stripped and the shape fixed,
  so three routes produce logs somebody can grep rather than three formats.
*/
export function agentFailureLog(scope, { agent, model, err }) {
  return [
    `[${scope}] agent request failed`,
    JSON.stringify({
      agent: agent || null,
      model: model || null,
      status: Number(err?.status) || null,
      type: err?.error?.error?.type || err?.name || null,
      message: redact(err?.error?.error?.message || err?.message || String(err)),
    }),
  ];
}
