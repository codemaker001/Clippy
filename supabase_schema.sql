-- ============================================================
-- Supabase Schema for Personal Dashboard Extension
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)
--
-- Architecture: 4 Tables (profiles, folders, notes, tombstones)
-- ============================================================

-- ============================================================
-- HELPER: Auto-update updated_at on every row change
-- ============================================================
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 1. PROFILES
--    User identity + vault keys + encrypted vault + settings
--    (merges old: profiles, vault_data, vault_keys, user_settings)
-- ============================================================
CREATE TABLE profiles (
  id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email               TEXT,
  name                TEXT,
  avatar_url          TEXT,
  provider            TEXT DEFAULT 'email',
  is_premium          BOOLEAN DEFAULT FALSE,
  premium_since       TIMESTAMPTZ,

  -- Vault keys (EDEK envelope)
  vault_salt          TEXT,
  vault_edek          TEXT,
  vault_edek_iv       TEXT,
  vault_validator     TEXT,
  vault_validator_iv  TEXT,

  -- Encrypted vault blob
  encrypted_vault     JSONB DEFAULT '{}',
  vault_version       INT DEFAULT 0,

  -- User settings
  settings            JSONB DEFAULT '{}',
  settings_updated_at TIMESTAMPTZ,

  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own profile"   ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE TRIGGER trg_profiles_updated
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ============================================================
-- 2. FOLDERS
--    Hierarchical folder structure for notes
-- ============================================================
CREATE TABLE folders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  pin        TEXT,
  parent_id  UUID REFERENCES folders(id) ON DELETE SET NULL,
  sort_order INT DEFAULT 0,
  version    INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, id)
);

ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own folders" ON folders FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_folders_user ON folders(user_id);

CREATE TRIGGER trg_folders_updated
  BEFORE UPDATE ON folders
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ============================================================
-- 3. NOTES
--    All note items: text, links, file references
-- ============================================================
CREATE TABLE notes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id      UUID REFERENCES folders(id) ON DELETE SET NULL,
  type           TEXT DEFAULT 'text',
  title          TEXT,
  content        TEXT,
  file_url       TEXT,
  file_mime_type TEXT,
  tags           TEXT[],
  color          TEXT,
  version        INT DEFAULT 1,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, id)
);

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own notes" ON notes FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_notes_user      ON notes(user_id);
CREATE INDEX idx_notes_folder    ON notes(user_id, folder_id);

CREATE TRIGGER trg_notes_updated
  BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ============================================================
-- 4. TOMBSTONES
--    Soft-delete tracking with entity type
-- ============================================================
CREATE TABLE tombstones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_id   UUID NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('note', 'folder')),
  version     INT DEFAULT 1,
  deleted_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, entity_id)
);

ALTER TABLE tombstones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own tombstones" ON tombstones FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_tombstones_user ON tombstones(user_id);

-- ============================================================
-- ENABLE REALTIME
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE notes;
ALTER PUBLICATION supabase_realtime ADD TABLE folders;
ALTER PUBLICATION supabase_realtime ADD TABLE tombstones;
ALTER PUBLICATION supabase_realtime ADD TABLE profiles;

-- ============================================================
-- STORAGE BUCKET for file uploads
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('user-files', 'user-files', false);

CREATE POLICY "Users upload own files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'user-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users read own files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'user-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users delete own files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'user-files' AND auth.uid()::text = (storage.foldername(name))[1]);
