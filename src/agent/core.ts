import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from './prompts.js';
import { getToolsForUser, executeTool } from '../tools/index.js';
import { env } from '../config/env.js';

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export interface AgentContext {
  chatId: string;
  userName: string;
  telegramId: string;
  companies: string[];
}

// In-memory conversation store (per chat)
const conversations = new Map<string, Anthropic.MessageParam[]>();

const MAX_MESSAGES = 40;
const MAX_TOOL_ROUNDS = 10;

export async function chat(ctx: AgentContext, userMessage: string): Promise<string> {
  let messages = conversations.get(ctx.chatId);
  if (!messages) {
    messages = [];
    conversations.set(ctx.chatId, messages);
  }

  messages.push({
    role: 'user',
    content: `[${ctx.userName}]: ${userMessage}`,
  });

  // Trim old messages to stay within limits
  while (messages.length > MAX_MESSAGES) {
    messages.shift();
  }

  const tools = getToolsForUser(ctx.companies);
  const response = await runAgentLoop(messages, tools, ctx);

  messages.push({ role: 'assistant', content: response });

  return response;
}

async function runAgentLoop(
  messages: Anthropic.MessageParam[],
  tools: Anthropic.Tool[],
  ctx: AgentContext,
): Promise<string> {
  let currentMessages = [...messages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages: currentMessages,
    });

    // No tool use — return the text response
    if (response.stop_reason !== 'tool_use') {
      return response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
    }

    // Execute all tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const result = await executeTool(block.name, block.input as Record<string, unknown>, ctx);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }
    }

    // Continue conversation with tool results
    currentMessages = [
      ...currentMessages,
      { role: 'assistant' as const, content: response.content },
      { role: 'user' as const, content: toolResults },
    ];
  }

  return "I've hit the maximum number of tool calls for this question. Could you try breaking it down?";
}

export function resetConversation(chatId: string): void {
  conversations.delete(chatId);
}
