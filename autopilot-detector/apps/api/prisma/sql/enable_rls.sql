-- Enable Row Level Security on all public tables.
--
-- WHY: Supabase exposes every public table through its auto-generated PostgREST
-- API, reachable with the project's public anon key. Without RLS, anyone with
-- the (publicly-shipped) anon key could read/write every row across all users
-- via https://<project>.supabase.co/rest/v1/<Table> — bypassing all the
-- application-layer authorization in the NestJS API.
--
-- This app does NOT use the Supabase REST API or anon key; it connects to
-- Postgres directly as the `postgres` role (which BYPASSES RLS). Therefore
-- enabling RLS with NO policies:
--   * blocks the anon/authenticated PostgREST roles from seeing ANY rows, and
--   * leaves Prisma / the backend completely unaffected (superuser bypass).
--
-- If this app ever adopts the Supabase client with the anon key, add explicit
-- per-user policies (e.g. USING ("userId" = auth.uid())) at that time.

ALTER TABLE "User"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutopilotScore"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Intervention"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SessionEmbedding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MoodEntry"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SessionEvent"     ENABLE ROW LEVEL SECURITY;
