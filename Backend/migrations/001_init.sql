-- OmniPrep.ai initial schema. {{EMBEDDING_DIM}} is substituted by src/db/migrate.js
-- from GEMINI_EMBEDDING_DIM so the vector column always matches the configured model.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid        NOT NULL,                 -- anonymous prototype session (see README "Access model")
  filename        text        NOT NULL,
  file_type       text        NOT NULL CHECK (file_type IN ('pdf', 'txt')),
  file_size       bigint      NOT NULL CHECK (file_size >= 0),
  storage_key     text        NOT NULL UNIQUE,
  status          text        NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed')),
  error_message   text,
  page_count      integer,
  chunk_count     integer     NOT NULL DEFAULT 0,
  embedding_model text,
  embedding_dim   integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_owner_created_idx ON documents (owner_id, created_at DESC);
CREATE INDEX documents_status_idx ON documents (status);

CREATE TABLE document_chunks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid        NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  chunk_index integer     NOT NULL,
  content     text        NOT NULL,
  page_number integer,
  embedding   vector({{EMBEDDING_DIM}}) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)                     -- also serves document_id lookups
);
-- Cosine distance (<=>) matches the normalised Gemini embeddings and the query operator in ragService.
CREATE INDEX document_chunks_embedding_hnsw_idx ON document_chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_owner_idx ON conversations (owner_id, updated_at DESC);

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid        NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  role            text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content         text        NOT NULL,
  citations       jsonb,
  grounding_status text,
  model_used      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at);
