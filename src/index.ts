import { GrammyError } from 'grammy';
import { createBot } from './bot/bot.js';
import { RateLimiter } from './bot/limiter.js';
import { UserStore } from './bot/store.js';
import { BRAND } from './brand.js';

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('BOT_TOKEN is missing. Copy .env.example to .env and add the token from @BotFather.');
  process.exit(1);
}

const store = new UserStore(process.env.DATA_FILE ?? './data/users.json');
const limiter = new RateLimiter(Number(process.env.SCANS_PER_MINUTE ?? 6));
const adminId = process.env.ADMIN_ID ? Number(process.env.ADMIN_ID) : undefined;

const bot = createBot({ token, store, limiter, adminId });

let stopping = false;
async function shutdown(signal: string) {
  stopping = true;
  console.log(`${signal} received, shutting down`);
  try {
    await bot.stop();
  } catch {
    // stop() can throw if we were still connecting; nothing to clean up in that case
  }
  await store.flush();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await bot.api.setMyCommands([
    { command: 'scan', description: 'Scan a token address' },
    { command: 'settings', description: 'Set your risk limit' },
    { command: 'chains', description: 'Supported chains' },
    { command: 'ref', description: 'Your invite link' },
    { command: 'help', description: 'How it works' },
  ]);
} catch (e) {
  // The command menu is cosmetic: don't let a network blip here stop the bot from starting.
  console.warn('Could not set the command menu, continuing:', e instanceof Error ? e.message : e);
}

// During a redeploy the old and new instance can overlap for a few seconds, and Telegram answers the
// newcomer with 409 ("another instance is polling"). Wait for the old one to stop instead of crashing.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
for (let attempt = 1; ; attempt++) {
  try {
    await bot.start({ onStart: (me) => console.log(`${BRAND} running as @${me.username}`) });
    break;
  } catch (e) {
    if (stopping) break;
    if (e instanceof GrammyError && e.error_code === 401) {
      console.error('Telegram rejected BOT_TOKEN (401). Check the token for typos or extra spaces, or get a new one with /revoke in @BotFather.');
      process.exit(1);
    }
    if (e instanceof GrammyError && e.error_code === 409 && attempt <= 24) {
      console.warn(`Another instance is still polling (409). Retrying in 5s (attempt ${attempt}/24)...`);
      await sleep(5000);
      continue;
    }
    throw e;
  }
}
