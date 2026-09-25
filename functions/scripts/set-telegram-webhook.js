// set-telegram-webhook.js
// Registers the deployed Cloud Function endpoint as the Telegram Bot Webhook
// -- a one-off script run by hand, so it needs the real token in the
// invoker's own shell env (`TELEGRAM_BOT_TOKEN=... node set-telegram-webhook.js`),
// never a literal in source.
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://telegramwebhook-tlp7bpmkua-uc.a.run.app';

async function main() {
  if (!BOT_TOKEN) {
    console.error('Missing TELEGRAM_BOT_TOKEN env var.');
    process.exit(1);
  }
  console.log(`Setting Telegram webhook for bot to: ${WEBHOOK_URL}`);
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(WEBHOOK_URL)}&allowed_updates=["message","pre_checkout_query"]`);
  const data = await res.json();
  console.log('Telegram setWebhook response:', data);

  const infoRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
  const infoData = await infoRes.json();
  console.log('Telegram getWebhookInfo:', infoData);
}

main().catch(console.error);
