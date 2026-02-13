import cron from 'node-cron';
import type { Bot } from 'grammy';
import { env } from '../config/env.js';
import { agentDb } from '../db/agent-db.js';
import { patagonDb } from '../db/patagon-db.js';

/**
 * Format a date as "Jan 15" style.
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}


/**
 * Send a message to the digest chat. Returns true if sent, false if skipped or failed.
 */
async function sendDigestMessage(bot: Bot, text: string): Promise<boolean> {
  const chatId = env.DIGEST_CHAT_ID;
  if (!chatId) return false;

  try {
    await bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    return true;
  } catch (error) {
    console.error('Failed to send digest message:', error);
    return false;
  }
}

/**
 * Daily Digest — runs every day at 9:00 AM UTC.
 *
 * Summarizes open tasks, ideas, recent notes/readings, and stuck Patagon purchases.
 */
async function dailyDigest(bot: Bot): Promise<void> {
  const sections: string[] = ['*Daily Digest*'];

  // Open tasks — list all with one-line summaries
  try {
    const { data: tasks, error } = await agentDb
      .from('notes')
      .select('content, summary, author_name, created_at')
      .eq('type', 'task')
      .eq('status', 'open')
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (tasks && tasks.length > 0) {
      let taskSection = `\n*Open Tasks (${tasks.length})*`;
      for (const task of tasks) {
        const date = formatDate(task.created_at);
        const text = task.summary || '(summarizing...)';
        taskSection += `\n  \u2022 ${text} _(${date})_`;
      }
      sections.push(taskSection);
    } else {
      sections.push('\n*Open Tasks:* none');
    }
  } catch (error) {
    console.error('Daily digest — failed to query tasks:', error);
  }

  // Open ideas — list all
  try {
    const { data: ideas, error } = await agentDb
      .from('notes')
      .select('content, summary, author_name, created_at')
      .eq('type', 'idea')
      .eq('status', 'open')
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (ideas && ideas.length > 0) {
      let ideaSection = `\n*Open Ideas (${ideas.length})*`;
      for (const idea of ideas) {
        const date = formatDate(idea.created_at);
        const text = idea.summary || '(summarizing...)';
        ideaSection += `\n  \u2022 ${text} _(${date})_`;
      }
      sections.push(ideaSection);
    } else {
      sections.push('\n*Open Ideas:* none');
    }
  } catch (error) {
    console.error('Daily digest — failed to query ideas:', error);
  }

  // Readings added in last 24 hours — list each
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: readings, error } = await agentDb
      .from('readings')
      .select('title, url, content_type, submitted_by_name')
      .gte('created_at', oneDayAgo)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (readings && readings.length > 0) {
      let readingSection = `\n*New Readings (${readings.length})*`;
      for (const r of readings) {
        const by = r.submitted_by_name ? ` — ${r.submitted_by_name}` : '';
        const link = r.url ? `\n    ${r.url}` : '';
        readingSection += `\n  \u2022 ${r.title} (${r.content_type}${by})${link}`;
      }
      sections.push(readingSection);
    }
  } catch (error) {
    console.error('Daily digest — failed to query recent readings:', error);
  }

  // Notes created in last 24 hours (excluding tasks/ideas already listed)
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: notes, error } = await agentDb
      .from('notes')
      .select('content, summary, type, author_name')
      .gte('created_at', oneDayAgo)
      .not('type', 'in', '("task","idea")')
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (notes && notes.length > 0) {
      let noteSection = `\n*New Notes (${notes.length})*`;
      for (const note of notes) {
        const text = note.summary || '(summarizing...)';
        noteSection += `\n  \u2022 ${text}`;
      }
      sections.push(noteSection);
    }
  } catch (error) {
    console.error('Daily digest — failed to query recent notes:', error);
  }

  // Patagon stuck purchases
  try {
    const { data, error } = await patagonDb.rpc('execute_readonly_query', {
      query_text:
        "SELECT count(*) as stuck_count FROM purchases WHERE status NOT IN ('completed', 'cancelled') AND created_at < now() - interval '7 days'",
    });

    if (error) throw error;

    const stuckCount = data?.[0]?.stuck_count ?? 0;
    if (stuckCount > 0) {
      sections.push(`\n*Patagon:* ${stuckCount} stuck purchases (pending > 7 days)`);
    }
  } catch (error) {
    console.error('Daily digest — failed to query Patagon stuck purchases:', error);
  }

  if (sections.length > 1) {
    const message = sections.join('\n');
    await sendDigestMessage(bot, message);
  }
}

/**
 * Stale Contact Alert — runs every Monday at 10:00 AM UTC.
 *
 * Flags contacts that haven't been updated in 60+ days.
 */
async function staleContactAlert(bot: Bot): Promise<void> {
  try {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

    const { data: staleContacts, error } = await agentDb
      .from('people')
      .select('name, company, updated_at')
      .lt('updated_at', sixtyDaysAgo)
      .order('updated_at', { ascending: true })
      .limit(10);

    if (error) {
      console.error('Stale contact alert — query failed:', error);
      return;
    }

    if (!staleContacts || staleContacts.length === 0) return;

    let message = "*Stale Contacts*\nHaven't been updated in 2+ months:\n";
    for (const contact of staleContacts) {
      const company = contact.company ? ` (${contact.company})` : '';
      const lastUpdated = formatDate(contact.updated_at);
      message += `\n  \u2022 ${contact.name}${company} \u2014 last updated ${lastUpdated}`;
    }

    await sendDigestMessage(bot, message);
  } catch (error) {
    console.error('Stale contact alert — unexpected error:', error);
  }
}

/**
 * Follow-up Reminder — runs every day at 9:30 AM UTC.
 *
 * Flags open tasks that have been open for more than 7 days.
 */
async function followUpReminder(bot: Bot): Promise<void> {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: overdueTasks, error } = await agentDb
      .from('notes')
      .select('content, summary, created_at')
      .eq('type', 'task')
      .eq('status', 'open')
      .lt('created_at', sevenDaysAgo)
      .order('created_at', { ascending: true })
      .limit(5);

    if (error) {
      console.error('Follow-up reminder — query failed:', error);
      return;
    }

    if (!overdueTasks || overdueTasks.length === 0) return;

    let message = '*Overdue Tasks*\nOpen for more than a week:\n';
    for (const task of overdueTasks) {
      const created = formatDate(task.created_at);
      const text = task.summary || '(summarizing...)';
      message += `\n  \u2022 ${text} (created ${created})`;
    }

    await sendDigestMessage(bot, message);
  } catch (error) {
    console.error('Follow-up reminder — unexpected error:', error);
  }
}

/**
 * Start all proactive scheduled jobs.
 *
 * If DIGEST_CHAT_ID is not configured, logs a warning and skips scheduling.
 */
/** Run all digests immediately (for manual testing via /digest command). */
export async function runAllDigestsNow(bot: Bot): Promise<void> {
  await dailyDigest(bot);
  await followUpReminder(bot);
  await staleContactAlert(bot);
}

export function startProactiveJobs(bot: Bot): void {
  if (!env.DIGEST_CHAT_ID) {
    console.warn('DIGEST_CHAT_ID not set — proactive jobs will not run.');
    return;
  }

  console.log(`Proactive jobs enabled — sending to chat ${env.DIGEST_CHAT_ID}`);

  // Daily Digest — every day at 9:00 AM UTC
  cron.schedule(
    '0 9 * * *',
    () => {
      console.log('Running daily digest...');
      dailyDigest(bot).catch((err) => console.error('Daily digest failed:', err));
    },
    { timezone: 'UTC' },
  );

  // Stale Contact Alert — every Monday at 10:00 AM UTC
  cron.schedule(
    '0 10 * * 1',
    () => {
      console.log('Running stale contact alert...');
      staleContactAlert(bot).catch((err) => console.error('Stale contact alert failed:', err));
    },
    { timezone: 'UTC' },
  );

  // Follow-up Reminder — every day at 9:30 AM UTC
  cron.schedule(
    '30 9 * * *',
    () => {
      console.log('Running follow-up reminder...');
      followUpReminder(bot).catch((err) => console.error('Follow-up reminder failed:', err));
    },
    { timezone: 'UTC' },
  );

  console.log('Scheduled: Daily digest (9:00 UTC), Follow-up reminder (9:30 UTC), Stale contacts (Mon 10:00 UTC)');
}
