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

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  await bot.stop();
  await store.flush();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await bot.api.setMyCommands([
  { command: 'scan', description: 'Scan a token address' },
  { command: 'settings', description: 'Set your risk limit' },
  { command: 'chains', description: 'Supported chains' },
  { command: 'ref', description: 'Your invite link' },
  { command: 'help', description: 'How it works' },
]);

await bot.start({
  onStart: (me) => console.log(`${BRAND} running as @${me.username}`),
});
