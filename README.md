# StormSafe CRM

Internal CRM for StormSafe Steel. Two-user shared client/quote/pipeline tracking
built on top of the existing CA and CCI quote builders.

## Setup (one-time, on each computer that will run this)

1. **Install Node.js** if you haven't already — https://nodejs.org (LTS version).
2. **Open a Command Prompt** in this folder. (Shift + right-click in the folder
   in File Explorer → "Open in Terminal" or "Open PowerShell window here".)
3. Run:
   ```
   npm install
   ```
   This downloads all the libraries the app needs. Takes ~1 minute the first time.

## Run it locally

```
npm run dev
```

This starts the app at http://localhost:3000 and opens it in your browser.
To stop: go to the Command Prompt and press `Ctrl + C`.

## Deploy to Vercel

See `DEPLOY.md` for step-by-step instructions.

## Environment variables

This app reads the Supabase URL and key from `.env.local` (not committed to git).

If `.env.local` is missing, copy `.env.example` to `.env.local` and fill in the
values from your Supabase project's API settings page.

## Folder structure

```
stormsafe-crm/
├── db/migrations/        # SQL migration files for the Supabase database
├── public/               # Static assets (favicon, etc.)
├── src/
│   ├── components/       # Reusable UI components
│   ├── context/          # React context providers (auth, etc.)
│   ├── lib/              # Shared utilities (supabase client, helpers)
│   ├── pages/            # Top-level page components
│   ├── App.jsx           # Routing
│   ├── main.jsx          # Entry point
│   └── styles.css        # Global styles
├── .env.example          # Template for environment variables
├── .env.local            # Actual env vars (gitignored)
├── index.html            # Root HTML
├── package.json          # Dependencies and scripts
└── vite.config.js        # Build tool config
```
