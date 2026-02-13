import type { ToolDefinition } from './types.js';
import type { AgentContext } from '../agent/core.js';
import { agentDb } from '../db/agent-db.js';
import { storeEmbeddingAsync, semanticSearch } from '../lib/embeddings.js';

export const peopleToolDefs: ToolDefinition[] = [
  {
    name: 'store_person',
    description: 'Store information about an external contact or person.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: "Person's full name" },
        company: { type: 'string', description: 'Their company/organization' },
        role: { type: 'string', description: 'Their role or title' },
        notes: { type: 'string', description: 'Notes about this person or relationship' },
        known_by: {
          type: 'array',
          items: { type: 'string' },
          description: 'Team member names who know this person',
        },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['name'],
    },
  },
  {
    name: 'search_people',
    description:
      'Search for people/contacts by name, company, or any keyword. Returns all known info.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Name, company, or search term' },
      },
      required: ['query'],
    },
  },
  {
    name: 'update_person',
    description: 'Update information about an existing contact.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Person ID' },
        notes: { type: 'string', description: 'Updated notes (replaces existing)' },
        company: { type: 'string' },
        role: { type: 'string' },
        known_by: {
          type: 'array',
          items: { type: 'string' },
          description: 'Updated list of team members who know this person',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_person',
    description: 'Permanently delete a contact from the people directory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'The person ID to delete' },
      },
      required: ['id'],
    },
  },
];

export async function executePeopleTool(
  name: string,
  input: Record<string, unknown>,
  _ctx: AgentContext,
): Promise<string> {
  switch (name) {
    case 'store_person': {
      const { data, error } = await agentDb
        .from('people')
        .insert({
          name: input.name as string,
          company: (input.company as string) || null,
          role: (input.role as string) || null,
          notes: (input.notes as string) || null,
          known_by: (input.known_by as string[]) || [],
          tags: (input.tags as string[]) || [],
        })
        .select('id, name')
        .single();

      if (error) return `Error storing person: ${error.message}`;

      // Fire-and-forget: generate and store embedding for semantic search
      const embeddingText = [
        input.name as string,
        (input.company as string) || '',
        (input.role as string) || '',
        (input.notes as string) || '',
        ...(input.known_by ? (input.known_by as string[]).map((k) => `knows:${k}`) : []),
        ...(input.tags ? (input.tags as string[]).map((t) => `#${t}`) : []),
      ].filter(Boolean).join(' ');
      storeEmbeddingAsync('people', data.id, embeddingText);

      return `Stored contact: ${data.name}.`;
    }

    case 'search_people': {
      const q = input.query as string;

      // Try semantic search first
      const semanticResults = await semanticSearch('people', q, { limit: 10 });
      if (semanticResults && semanticResults.length > 0) {
        const sourceIds = semanticResults.map((r) => r.source_id);
        const { data, error } = await agentDb
          .from('people')
          .select('*')
          .in('id', sourceIds);

        if (!error && data && data.length > 0) {
          // Re-sort by similarity order from semantic search
          const idOrder = new Map(sourceIds.map((id, i) => [id, i]));
          data.sort((a, b) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999));
          return JSON.stringify(data, null, 2);
        }
      }

      // Fallback: ilike keyword search
      const { data, error } = await agentDb
        .from('people')
        .select('*')
        .or(`name.ilike.%${q}%,company.ilike.%${q}%,role.ilike.%${q}%,notes.ilike.%${q}%`)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) return `Search error: ${error.message}`;
      if (!data || data.length === 0) return 'No people found.';
      return JSON.stringify(data, null, 2);
    }

    case 'update_person': {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (input.notes !== undefined) updates.notes = input.notes;
      if (input.company !== undefined) updates.company = input.company;
      if (input.role !== undefined) updates.role = input.role;
      if (input.known_by !== undefined) updates.known_by = input.known_by;

      const { error } = await agentDb
        .from('people')
        .update(updates)
        .eq('id', input.id as string);

      if (error) return `Error updating person: ${error.message}`;

      // Re-embed with latest data if any searchable fields were updated
      if (input.notes !== undefined || input.company !== undefined || input.role !== undefined) {
        // Fetch the full record to build a complete embedding
        const { data: person } = await agentDb
          .from('people')
          .select('name, company, role, notes, known_by, tags')
          .eq('id', input.id as string)
          .single();

        if (person) {
          const embeddingText = [
            person.name,
            person.company || '',
            person.role || '',
            person.notes || '',
            ...(person.known_by || []).map((k: string) => `knows:${k}`),
            ...(person.tags || []).map((t: string) => `#${t}`),
          ].filter(Boolean).join(' ');
          storeEmbeddingAsync('people', input.id as string, embeddingText);
        }
      }

      return 'Person updated.';
    }

    case 'delete_person': {
      await agentDb
        .from('embeddings')
        .delete()
        .eq('source_table', 'people')
        .eq('source_id', input.id as string);

      const { error } = await agentDb
        .from('people')
        .delete()
        .eq('id', input.id as string);

      if (error) return `Error deleting person: ${error.message}`;
      return 'Person deleted.';
    }

    default:
      return `Unknown people tool: ${name}`;
  }
}
