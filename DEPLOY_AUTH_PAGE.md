# Deploy the Auth Page

The auth page (`auth-page/`) needs to be hosted on a public URL so the Chrome extension can open it for login.

## Step 1: Supabase Authentication Setup

Enable the login methods in your Supabase Dashboard.

1. Go to [Supabase Dashboard](https://supabase.com/dashboard).
2. Select your project → **Authentication** → **Providers**.
3. Enable **Email** (enabled by default).
4. Enable **Google**:
    - Create OAuth credentials in [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
    - Add your auth page URL to **Authorized redirect URIs**: `https://YOUR_PROJECT.supabase.co/auth/v1/callback`
    - Copy the **Client ID** and **Client Secret** into Supabase.
5. (Optional) Enable **GitHub**:
    - Create an OAuth App at [GitHub Developer Settings](https://github.com/settings/developers).
    - **Authorization callback URL**: `https://YOUR_PROJECT.supabase.co/auth/v1/callback`
    - Copy your GitHub **Client ID** and **Client Secret** into Supabase.

## Step 2: Set Supabase URLs

In Supabase Dashboard → **Authentication** → **URL Configuration**:
- **Site URL**: Set to your auth page URL (e.g., `https://your-app.vercel.app`)
- **Redirect URLs**: Add your auth page URL (e.g., `https://your-app.vercel.app/*`)

## Step 3: Generate Config

1. Copy `.env.example` to `.env`
2. Fill in your Supabase credentials:
   ```
   SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   SUPABASE_ANON_KEY=eyJ...
   AUTH_PAGE_URL=https://your-app.vercel.app
   EXTENSION_ID=your-chrome-extension-id
   ```
3. Run:
   ```
   node setup-env.js
   ```

## Step 4: Deploy to a Hosting Provider

You can deploy the `auth-page/` folder to any static hosting provider:

### Option A: Vercel (Recommended)
1. Push your project to GitHub
2. Go to [vercel.com](https://vercel.com) and import the repository
3. Set the **Root Directory** to `auth-page`
4. Deploy

### Option B: Netlify
1. Go to [netlify.com](https://netlify.com)
2. Drag and drop the `auth-page/` folder
3. Your site will be live instantly

### Option C: GitHub Pages
1. Push the `auth-page/` contents to a `gh-pages` branch
2. Enable GitHub Pages in your repo settings

## Step 5: Update Extension

1. Update `AUTH_PAGE_URL` in your `.env` to the deployed URL
2. Run `node setup-env.js` again
3. Update `externally_connectable.matches` in `manifest.json` to include your deployed URL
4. Reload the extension in `chrome://extensions/`

## Step 6: Verify

1. Click the extension icon
2. Click "Sign In"
3. Your deployed auth page should open
4. Sign in with Google or Email
5. You should see "Authentication Successful" and data will sync
