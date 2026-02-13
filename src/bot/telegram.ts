import { Bot } from 'grammy';
import { env } from '../config/env.js';
import { getTeamMember, isTeamMember } from '../config/team.js';
import { chat, resetConversation } from '../agent/core.js';

export function createBot(): Bot {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  // Auth middleware — only allow team members
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id?.toString();
    if (!userId || !isTeamMember(userId)) {
      await ctx.reply('This bot is only available to team members.');
      return;
    }
    await next();
  });

  bot.command('start', async (ctx) => {
    await ctx.reply(
      "Hey! I'm the company agent for THC and Patagon.\n\n" +
        'Ask me anything — business metrics, people info, or tell me to remember something.\n\n' +
        '/reset — Clear conversation history\n' +
        '/help — What I can do',
    );
  });

  bot.command('reset', async (ctx) => {
    resetConversation(ctx.chat.id.toString());
    await ctx.reply('Conversation cleared.');
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      "Here's what I can do:\n\n" +
        '• Patagon data — "How much volume this month?", "Which purchases are pending?"\n' +
        '• Notes & tasks — "Remember that...", "What tasks are open?"\n' +
        '• Ideas — "Store idea: ...", "What ideas have we had?"\n' +
        '• Nerd Fuel — Share a URL or "Store as nerd fuel: ..."\n' +
        '• People — "What do we know about X?", "Store contact: ..."\n\n' +
        'Just type naturally.',
    );
  });

  // Handle all text messages
  bot.on('message:text', async (ctx) => {
    const chatId = ctx.chat.id.toString();
    const userId = ctx.from.id.toString();
    const member = getTeamMember(userId);
    const userName = member?.name || ctx.from.first_name || 'Unknown';
    const companies = member?.companies || ['thc'];

    // Show typing indicator
    await ctx.replyWithChatAction('typing');

    // Keep typing indicator alive during long operations
    const typingInterval = setInterval(() => {
      ctx.replyWithChatAction('typing').catch(() => {});
    }, 4000);

    try {
      const response = await chat(
        { chatId, userName, telegramId: userId, companies },
        ctx.message.text,
      );

      clearInterval(typingInterval);

      // Telegram has a 4096 char limit per message
      if (response.length > 4000) {
        for (const chunk of splitMessage(response, 4000)) {
          await ctx.reply(chunk);
        }
      } else {
        await ctx.reply(response);
      }
    } catch (error) {
      clearInterval(typingInterval);
      console.error('Agent error:', error);
      await ctx.reply('Something went wrong. Try again or /reset the conversation.');
    }
  });

  return bot;
}

function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Split at last newline within limit
    let splitIndex = remaining.lastIndexOf('\n', maxLength);
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}
