function trim(value: string | undefined) {
  return value?.trim() || "";
}

export function getConfig() {
  const publicUrl =
    trim(process.env.PUBLIC_URL) ||
    (trim(process.env.VERCEL_URL)
      ? `https://${trim(process.env.VERCEL_URL)}`
      : "");

  return {
    publicUrl,
    slackClientId: trim(process.env.SLACK_CLIENT_ID),
    slackClientSecret: trim(process.env.SLACK_CLIENT_SECRET),
    slackSigningSecret: trim(process.env.SLACK_SIGNING_SECRET),
    slackBotToken: trim(process.env.SLACK_BOT_TOKEN),
    cursorApiKey: trim(process.env.CURSOR_API_KEY || process.env.CURSOR_WEBHOOK_TOKEN),
    cursorStatusWebhookSecret: trim(process.env.CURSOR_STATUS_WEBHOOK_SECRET),
    cursorStatusWebhookUrl: publicUrl
      ? `${publicUrl}/api/cursor/status`
      : "",
    githubToken: trim(process.env.GITHUB_TOKEN),
    githubOrg: trim(process.env.GITHUB_ORG),
    agentTemplateRepo: trim(process.env.AGENT_TEMPLATE_REPO),
    sessionSecret:
      trim(process.env.SESSION_SECRET) ||
      trim(process.env.CRON_SECRET) ||
      "dev-session-secret-change-me",
    vaultMasterKey:
      trim(process.env.VAULT_MASTER_KEY) ||
      trim(process.env.SESSION_SECRET) ||
      "dev-vault-master-key-change-me",
    cronSecret: trim(process.env.CRON_SECRET),
    operatorSlackIds: trim(process.env.OPERATOR_SLACK_IDS)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    operatorEmails: trim(process.env.OPERATOR_EMAILS)
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    upstashUrl: trim(
      process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    ),
    upstashToken: trim(
      process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
    ),
  };
}

export function isMockCursor() {
  return !getConfig().cursorApiKey;
}

export function isOperator(user: {
  email?: string;
  slackUserId?: string;
}) {
  // The monitor spans every workspace, so only explicitly listed admins get it.
  const { operatorEmails, operatorSlackIds } = getConfig();
  if (user.email && operatorEmails.includes(user.email.toLowerCase())) {
    return true;
  }
  if (user.slackUserId && operatorSlackIds.includes(user.slackUserId)) {
    return true;
  }
  return false;
}
