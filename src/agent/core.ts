import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { SYSTEM_PROMPT } from './prompts.js';
import { getToolsForUser, executeTool } from '../tools/index.js';
import type { ToolDefinition } from '../tools/types.js';
import { env } from '../config/env.js';
import { agentDb } from '../db/agent-db.js';
import { getModelConfig, selectModel } from './router.js';

const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: env.OPENROUTER_API_KEY,
});

export interface AgentContext {
  chatId: string;
  userName: string;
  telegramId: string;
  companies: string[];
}

// In-memory conversation cache (per chat). Hydrated from DB on first access.
const conversations = new Map<string, ChatCompletionMessageParam[]>();

const MAX_MESSAGES = 40;
const MAX_TOOL_ROUNDS = 10;

// ─── DB helpers ──────────────────────────────────────────────────────────────

/** Load the most recent messages from the DB for a given chat. */
async function loadMessagesFromDb(chatId: string): Promise<ChatCompletionMessageParam[]> {
  try {
    const { data, error } = await agentDb
      .from('messages')
      .select('role, content')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(MAX_MESSAGES);

    if (error) {
      console.error('Failed to load conversation history from DB:', error);
      return [];
    }

    if (!data || data.length === 0) return [];

    return data.map((row) => ({
      role: row.role as 'user' | 'assistant',
      content: row.content as string,
    }));
  } catch (err) {
    console.error('Exception loading conversation history:', err);
    return [];
  }
}

/** Save a single message to the DB. Fire-and-forget with error logging. */
function saveMessageToDb(chatId: string, role: 'user' | 'assistant', content: string): void {
  void (async () => {
    try {
      const { error } = await agentDb
        .from('messages')
        .insert({ chat_id: chatId, role, content });
      if (error) console.error('Failed to save message to DB:', error);
    } catch (err: unknown) {
      console.error('Exception saving message to DB:', err);
    }
  })();
}

/** Delete all messages for a chat from the DB. Fire-and-forget. */
function deleteMessagesFromDb(chatId: string): void {
  void (async () => {
    try {
      const { error } = await agentDb
        .from('messages')
        .delete()
        .eq('chat_id', chatId);
      if (error) console.error('Failed to delete messages from DB:', error);
    } catch (err: unknown) {
      console.error('Exception deleting messages from DB:', err);
    }
  })();
}

/**
 * Delete the oldest messages from the DB for a chat, keeping only the most recent `keep` rows.
 * Fire-and-forget.
 */
function trimMessagesInDb(chatId: string, keep: number): void {
  void (async () => {
    try {
      // Find rows beyond the keep limit
      const { data, error } = await agentDb
        .from('messages')
        .select('id')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(keep, keep + 1000);

      if (error) {
        console.error('Failed to query messages for trimming:', error);
        return;
      }
      if (!data || data.length === 0) return;

      const idsToDelete = data.map((row: { id: number }) => row.id);
      const { error: delError } = await agentDb
        .from('messages')
        .delete()
        .in('id', idsToDelete);
      if (delError) console.error('Failed to trim old messages from DB:', delError);
    } catch (err: unknown) {
      console.error('Exception trimming messages in DB:', err);
    }
  })();
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function chat(ctx: AgentContext, userMessage: string, imageUrl?: string): Promise<string> {
  // Hydrate from DB on cache miss (e.g. after restart)
  let messages = conversations.get(ctx.chatId);
  if (!messages) {
    messages = await loadMessagesFromDb(ctx.chatId);
    conversations.set(ctx.chatId, messages);
  }

  const textContent = `[${ctx.userName}]: ${userMessage}`;

  if (imageUrl) {
    // Multimodal message: text + image
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: textContent },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    });
  } else {
    messages.push({
      role: 'user',
      content: textContent,
    });
  }

  // Persist only the text portion to DB
  saveMessageToDb(ctx.chatId, 'user', textContent);

  // Trim old messages to stay within limits
  if (messages.length > MAX_MESSAGES) {
    const excess = messages.length - MAX_MESSAGES;
    messages.splice(0, excess);
    trimMessagesInDb(ctx.chatId, MAX_MESSAGES);
  }

  const tools = getToolsForUser(ctx.companies);
  const response = await runAgentLoop(messages, tools, ctx, !!imageUrl);

  messages.push({ role: 'assistant', content: response });

  // Persist assistant response to DB
  saveMessageToDb(ctx.chatId, 'assistant', response);

  // Trim again in case we just exceeded the limit
  if (messages.length > MAX_MESSAGES) {
    const excess = messages.length - MAX_MESSAGES;
    messages.splice(0, excess);
    trimMessagesInDb(ctx.chatId, MAX_MESSAGES);
  }

  return response;
}

/** Convert our tool definitions to OpenAI function-calling format */
function toOpenAITools(defs: ToolDefinition[]): ChatCompletionTool[] {
  return defs.map((d) => ({
    type: 'function' as const,
    function: {
      name: d.name,
      description: d.description,
      parameters: d.input_schema,
    },
  }));
}

async function runAgentLoop(
  messages: ChatCompletionMessageParam[],
  tools: ToolDefinition[],
  ctx: AgentContext,
  hasImage: boolean,
): Promise<string> {
  const openaiTools = toOpenAITools(tools);
  const modelConfig = getModelConfig();
  let currentMessages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages,
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const route = selectModel(modelConfig, round, hasImage);
    console.log(`[router] round=${round} model=${route.model} tier=${route.tier} (${route.reason})`);

    const response = await openrouter.chat.completions.create({
      model: route.model,
      max_tokens: 4096,
      tools: openaiTools,
      messages: currentMessages,
    });

    const choice = response.choices[0];
    if (!choice) return 'No response from model.';

    const message = choice.message;

    // No tool calls — return the text response
    if (!message.tool_calls || message.tool_calls.length === 0) {
      return message.content || '';
    }

    // Add the assistant message with tool calls to the conversation
    currentMessages = [
      ...currentMessages,
      message,
    ];

    // Execute all tool calls and add results
    for (const toolCall of message.tool_calls) {
      const input = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
      const result = await executeTool(toolCall.function.name, input, ctx);
      currentMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  return "I've hit the maximum number of tool calls for this question. Could you try breaking it down?";
}

export function resetConversation(chatId: string): void {
  conversations.delete(chatId);
  deleteMessagesFromDb(chatId);
}
