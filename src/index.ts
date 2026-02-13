import { createBot } from './bot/telegram.js';
import { startProactiveJobs } from './bot/proactive.js';

async function main() {
  console.log('Starting company agent...');

  const bot = createBot();

  const shutdown = () => {
    console.log('Shutting down...');
    bot.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await bot.start({
    onStart: (botInfo) => {
      console.log(`Bot running as @${botInfo.username}`);
      startProactiveJobs(bot);
    },
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
