import type { ToolDefinition } from './types.js';
import type { AgentContext } from '../agent/core.js';
import { patagonDbToolDef, executePatagonDb } from './patagon-db.js';
import { knowledgeToolDefs, executeKnowledgeTool } from './knowledge.js';
import { readingsToolDefs, executeReadingsTool } from './readings.js';
import { peopleToolDefs, executePeopleTool } from './people.js';
import { transcriptsToolDefs, executeTranscriptsTool } from './transcripts.js';

interface ToolEntry {
  definition: ToolDefinition;
  company?: string; // If set, only users with this company can use it
  execute: (input: Record<string, unknown>, ctx: AgentContext) => Promise<string>;
}

const allTools: ToolEntry[] = [
  // Shared tools (everyone)
  ...knowledgeToolDefs.map((def) => ({
    definition: def,
    execute: (input: Record<string, unknown>, ctx: AgentContext) =>
      executeKnowledgeTool(def.name, input, ctx),
  })),
  ...readingsToolDefs.map((def) => ({
    definition: def,
    execute: (input: Record<string, unknown>, ctx: AgentContext) =>
      executeReadingsTool(def.name, input, ctx),
  })),
  ...peopleToolDefs.map((def) => ({
    definition: def,
    execute: (input: Record<string, unknown>, ctx: AgentContext) =>
      executePeopleTool(def.name, input, ctx),
  })),
  ...transcriptsToolDefs.map((def) => ({
    definition: def,
    execute: (input: Record<string, unknown>, ctx: AgentContext) =>
      executeTranscriptsTool(def.name, input, ctx),
  })),

  // Patagon-specific
  {
    definition: patagonDbToolDef,
    company: 'patagon',
    execute: (input: Record<string, unknown>) => executePatagonDb(input),
  },
];

// Tool lookup by name for fast dispatch
const toolMap = new Map(allTools.map((t) => [t.definition.name, t]));

export function getToolsForUser(companies: string[]): ToolDefinition[] {
  return allTools
    .filter((t) => !t.company || companies.includes(t.company))
    .map((t) => t.definition);
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: AgentContext,
): Promise<string> {
  const tool = toolMap.get(name);
  if (!tool) return `Unknown tool: ${name}`;

  try {
    return await tool.execute(input, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return `Tool error (${name}): ${message}`;
  }
}
