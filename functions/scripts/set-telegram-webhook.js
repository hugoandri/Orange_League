// set-telegram-webhook.js
// Registers the deployed Cloud Function endpoint as the Telegram Bot Webhook
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8922530812:AAFJeIUrTlRPEiMIDLtSyoHCURwX5bDyyVQ';
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://telegramwebhook-vdtw4dcfdq-uc.a.run.app';

async function main() {
  console.log(`Setting Telegram webhook for bot to: ${WEBHOOK_URL}`);
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(WEBHOOK_URL)}&allowed_updates=["message","pre_checkout_query"]`);
  const data = await res.json();
  console.log('Telegram setWebhook response:', data);

  const infoRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
  const infoData = await infoRes.json();
  console.log('Telegram getWebhookInfo:', infoData);
}

main().catch(console.error);
