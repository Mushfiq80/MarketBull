-- Extensions required by BABull.
-- Runs once, on first container start, against the POSTGRES_DB database.

CREATE EXTENSION IF NOT EXISTS "vector";      -- pgvector: document retrieval
CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- trigram search on issuer/ticker names
CREATE EXTENSION IF NOT EXISTS "btree_gin";   -- composite indexes on jsonb + scalars

-- Internal storage is UTC everywhere. Display conversion to +06:00 happens in the app.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC');
END
$$;
