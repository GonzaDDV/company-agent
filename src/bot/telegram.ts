import { Bot } from 'grammy';
import { env } from '../config/env.js';
import { getTeamMember, isTeamMember } from '../config/team.js';
import { chat, resetConversation } from '../agent/core.js';
import { runAllDigestsNow } from './proactive.js';
import { fetchUrlTitle, isBareUrl } from '../lib/url-metadata.js';

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

  bot.command('digest', async (ctx) => {
    await ctx.reply('Running all digests...');
    await runAllDigestsNow(bot);
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

    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
    let messageText = ctx.message.text;

    // In group chats, only respond to @mentions or replies to the bot
    if (isGroup) {
      const botUsername = ctx.me.username;
      const botId = ctx.me.id;

      const isMentioned =
        botUsername &&
        ctx.message.entities?.some(
          (e) =>
            e.type === 'mention' &&
            messageText
              .slice(e.offset, e.offset + e.length)
              .toLowerCase() === `@${botUsername.toLowerCase()}`,
        );

      const isReplyToBot =
        ctx.message.reply_to_message?.from?.id === botId;

      if (!isMentioned && !isReplyToBot) {
        return; // Ignore messages not directed at the bot
      }

      // Strip the @mention from the message text
      if (isMentioned && botUsername) {
        messageText = messageText
          .replace(new RegExp(`@${botUsername}\\b`, 'gi'), '')
          .trim();
      }

      // Don't process empty messages after stripping the mention
      if (!messageText) {
        return;
      }
    }

    // Show typing indicator
    await ctx.replyWithChatAction('typing');

    // Enrich bare URLs with page title for better storage
    if (isBareUrl(messageText)) {
      const title = await fetchUrlTitle(messageText);
      if (title) {
        messageText = `[URL: ${messageText} | Page title: ${title}]`;
      }
    }

    // Keep typing indicator alive during long operations
    const typingInterval = setInterval(() => {
      ctx.replyWithChatAction('typing').catch(() => {});
    }, 4000);

    try {
      const response = await chat(
        { chatId, userName, telegramId: userId, companies },
        messageText,
      );

      clearInterval(typingInterval);

      // Telegram has a 4096 char limit per message
      const noPreview = { link_preview_options: { is_disabled: true } };
      if (response.length > 4000) {
        for (const chunk of splitMessage(response, 4000)) {
          await ctx.reply(chunk, noPreview);
        }
      } else {
        await ctx.reply(response, noPreview);
      }
    } catch (error) {
      clearInterval(typingInterval);
      console.error('Agent error:', error);
      await ctx.reply('Something went wrong. Try again or /reset the conversation.');
    }
  });

  // Handle photo messages
  bot.on('message:photo', async (ctx) => {
    const chatId = ctx.chat.id.toString();
    const userId = ctx.from.id.toString();
    const member = getTeamMember(userId);
    const userName = member?.name || ctx.from.first_name || 'Unknown';
    const companies = member?.companies || ['thc'];

    const caption = ctx.message.caption || 'Sent an image';

    // Get the highest-resolution photo
    const photo = ctx.message.photo[ctx.message.photo.length - 1];

    await ctx.replyWithChatAction('typing');

    const typingInterval = setInterval(() => {
      ctx.replyWithChatAction('typing').catch(() => {});
    }, 4000);

    try {
      // Download the photo
      const file = await ctx.api.getFile(photo.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

      const res = await fetch(fileUrl);
      if (!res.ok) throw new Error(`Failed to download photo: ${res.status}`);

      const buffer = Buffer.from(await res.arrayBuffer());
      const ext = file.file_path?.split('.').pop() || 'jpg';
      const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
      const base64Url = `data:${mimeType};base64,${buffer.toString('base64')}`;

      const response = await chat(
        { chatId, userName, telegramId: userId, companies },
        caption,
        base64Url,
      );

      clearInterval(typingInterval);

      const noPreview = { link_preview_options: { is_disabled: true } };
      if (response.length > 4000) {
        for (const chunk of splitMessage(response, 4000)) {
          await ctx.reply(chunk, noPreview);
        }
      } else {
        await ctx.reply(response, noPreview);
      }
    } catch (error) {
      clearInterval(typingInterval);
      console.error('Photo handling error:', error);
      await ctx.reply('Something went wrong processing the image. Try again or /reset.');
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
