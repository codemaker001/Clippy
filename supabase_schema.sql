-- ============================================================
-- Supabase Schema for Personal Dashboard Extension
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- ============================================================
-- PROFILES (user registry)
-- ============================================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  name TEXT,
  avatar_url TEXT,
  provider TEXT DEFAULT 'email',
  is_premium BOOLEAN DEFAULT FALSE,
  premium_since TIMESTAMPTZ,
  extension_version TEXT,
  registered_at TIMESTAMPTZ DEFAULT now(),
  last_synced_at TIMESTAMPTZ
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own profile"   ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- ============================================================
-- FOLDERS
-- ============================================================
CREATE TABLE folders (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  uuid TEXT NOT NULL,
  name TEXT NOT NULL,
  pin TEXT,
  parent_id TEXT,
  "order" INT DEFAULT 0,
  version INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, uuid)
);

ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own folders" ON folders FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_folders_user ON folders(user_id);

-- ============================================================
-- NOTES
-- ============================================================
CREATE TABLE notes (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  uuid TEXT NOT NULL,
  folder_uuid TEXT,
  type TEXT DEFAULT 'text',
  title TEXT,
  content TEXT,
  file_url TEXT,
  file_mime_type TEXT,
  tags TEXT[],
  version INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, uuid)
);

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own notes" ON notes FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_notes_user ON notes(user_id);
CREATE INDEX idx_notes_folder ON notes(user_id, folder_uuid);

-- ============================================================
-- VAULT DATA (encrypted blob)
-- ============================================================
CREATE TABLE vault_data (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  encrypted_vault JSONB NOT NULL DEFAULT '{}',
  version INT DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE vault_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own vault" ON vault_data FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- VAULT KEYS (EDEK — encrypted data encryption key)
-- ============================================================
CREATE TABLE vault_keys (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  salt TEXT NOT NULL,
  edek TEXT NOT NULL,
  edek_iv TEXT NOT NULL,
  validator TEXT NOT NULL,
  validator_iv TEXT NOT NULL
);

ALTER TABLE vault_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own keys" ON vault_keys FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- SETTINGS
-- ============================================================
CREATE TABLE user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  settings JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own settings" ON user_settings FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- TOMBSTONES
-- ============================================================
CREATE TABLE tombstones (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  uuid TEXT NOT NULL,
  version INT DEFAULT 1,
  deleted_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, uuid)
);

ALTER TABLE tombstones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own tombstones" ON tombstones FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_tombstones_user ON tombstones(user_id);

-- ============================================================
-- ENABLE REALTIME
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE notes;
ALTER PUBLICATION supabase_realtime ADD TABLE folders;
ALTER PUBLICATION supabase_realtime ADD TABLE vault_data;
ALTER PUBLICATION supabase_realtime ADD TABLE tombstones;

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
