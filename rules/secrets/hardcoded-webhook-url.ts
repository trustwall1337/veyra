// Test fixture for `hardcoded-webhook-url` rule.

// ---- Positive: Slack webhook hardcoded ----
// The third path segment is intentionally short ("EXAMPLE") so this
// fixture does not look like a 24-char Slack secret to push-protection
// detectors. The semgrep regex `[A-Za-z0-9/_-]+` matches the short form
// just as well.
// ruleid: hardcoded-webhook-url
const slackHook = 'https://hooks.slack.com/services/T00000000/B00000000/EXAMPLE';

// ---- Positive: Discord webhook hardcoded ----
// ruleid: hardcoded-webhook-url
const discordHook = 'https://discord.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz';

// ---- Positive: legacy discordapp.com domain ----
// ruleid: hardcoded-webhook-url
const discordappHook = 'https://discordapp.com/api/webhooks/000000000/yyyyyyyyyyyyyyyyy';

// ---- Negative: env-loaded webhook URL (no literal URL) ----
// ok: hardcoded-webhook-url
const fromEnv = process.env.SLACK_WEBHOOK_URL;

// ---- Negative: unrelated Slack-API URL (not the webhook path) ----
// ok: hardcoded-webhook-url
const slackApiBase = 'https://slack.com/api/chat.postMessage';

// ---- Negative: a generic URL that mentions hooks.slack.com only as text ----
// ok: hardcoded-webhook-url
const docComment = 'See https://api.slack.com/messaging/webhooks for the format.';

// silence unused-var warnings for fixture
export {
  slackHook,
  discordHook,
  discordappHook,
  fromEnv,
  slackApiBase,
  docComment,
};
