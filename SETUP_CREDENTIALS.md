# Setup Credentials

This guide helps you set up all the credentials needed for the Personal Dashboard extension.

## Prerequisites

- A [Supabase](https://supabase.com) account and project
- [Node.js](https://nodejs.org) installed on your machine

## Step 1: Create a Supabase Project

1. Go to [Supabase Dashboard](https://supabase.com/dashboard).
2. Click **New Project**.
3. Choose an organization, name your project, set a database password, and select a region.
4. Wait for the project to be created.

## Step 2: Run the SQL Schema

1. In your Supabase Dashboard, go to **SQL Editor**.
2. Open the file `supabase_schema.sql` from this project.
3. Copy and paste the entire contents into the SQL Editor.
4. Click **Run** to create all tables, indexes, RLS policies, and the storage bucket.

## Step 3: Get Supabase Credentials

1. In your Supabase Dashboard, go to **Project Settings** → **API**.
2. Copy the following values:
   - **Project URL** (e.g., `https://abcdefg.supabase.co`)
   - **anon public** key (starts with `eyJ...`)

3. Fill in your `.env` file:
   ```
   SUPABASE_URL=https://abcdefg.supabase.co
   SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
   ADMIN_EMAILS=your-email@gmail.com
   AUTH_PAGE_URL=https://your-auth-page.vercel.app
   EXTENSION_ID=your-chrome-extension-id
   ```

## Step 4: Get Your Extension ID

1. Open `chrome://extensions/` in Chrome.
2. Enable **Developer mode** (toggle in the top right).
3. Click **Load unpacked** and select this project folder.
4. Copy the **ID** shown under the extension name (e.g., `dnhikbnbnljdenedgkmadcjjflcbniop`).
5. Add it to your `.env` file as `EXTENSION_ID`.

## Step 5: Generate Config Files

Run the setup script:

```bash
node setup-env.js
```

This generates:
- `core/env.js` — Supabase config for the extension
- `auth-page/config.js` — Supabase config for the login page

## Step 6: Enable Auth Providers

See `DEPLOY_AUTH_PAGE.md` for instructions on enabling Google and GitHub login in Supabase.

## Step 7: Deploy the Auth Page

See `DEPLOY_AUTH_PAGE.md` for deployment instructions.

## Step 8: Reload Extension

1. Go to `chrome://extensions/`
2. Click the reload button on the Personal Dashboard extension
3. Click the extension icon and try signing in
