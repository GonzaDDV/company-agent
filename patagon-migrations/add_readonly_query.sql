-- Apply this migration in the PATAGON repo (not the agent repo).
-- It creates a read-only query function that the agent uses to query Patagon's database.
--
-- Copy this file to: patagon/supabase/migrations/xxx_agent_readonly_query.sql
-- Then run: pnpm db:push

CREATE OR REPLACE FUNCTION execute_readonly_query(query_text text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '5s'
AS $$
DECLARE
  result jsonb;
BEGIN
  -- Only allow SELECT statements
  IF NOT (trim(upper(query_text)) LIKE 'SELECT%') THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;

  -- Block dangerous keywords
  IF query_text ~* '\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXECUTE)\b' THEN
    RAISE EXCEPTION 'Mutation queries are not allowed';
  END IF;

  EXECUTE 'SELECT coalesce(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (' || query_text || ') t'
  INTO result;

  RETURN result;
END;
$$;
