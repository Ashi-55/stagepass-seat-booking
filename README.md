# Stagepass

## Architecture

An event seat-booking app built with Angular and NestJS in TypeScript. NestJS serves the Angular bundle and JSON API from one origin. PostgreSQL holds the authoritative seating state. The same code runs with local PostgreSQL or a dedicated Supabase PostgreSQL database.

## Run locally

Install Git and Node.js 22.13 or newer in the 22.x series. Then run:

    git clone https://github.com/Ashi-55/stagepass-seat-booking.git
    cd stagepass-seat-booking

    npm ci
    npm run build
    npm run local

Open http://127.0.0.1:8125. On Windows PowerShell you can use npm.cmd in place of npm. The local launcher starts a persistent PostgreSQL instance on loopback port 55438 and keeps its files in the ignored .pgdata folder. Local demo organizer credentials are **organizer** and **StageDemo2026!**. Visitors browse event listings. Sign in or create an account to see seating and book.

## Use your Supabase project

In the dedicated Stagepass project's **Connect** dialog, copy its PostgreSQL **Session pooler** connection string. Substitute the URL-encoded database password. Copy .env.example to .env, fill in DATABASE_URL with the full URI and set STAGE_ORGANIZER_PASSWORD to your chosen bootstrap password. Use TLS when connecting remotely. Keep .env private. Run:

    npm ci
    npm run build
    npm start

On initial connection the server creates a private stagepass schema and seeds two events (120 and 60 seats) with 15 confirmed bookings per event. Use a database role authorized to create the schema. Future starts preserve the data. Organizer credentials are set on first initialization. The Angular bundle only sends same-origin /api requests. Supabase supplies PostgreSQL; NestJS manages application accounts, sessions, and authorization. The application needs no Supabase Data API access to the schema.

The local demo and hosted database are independent.

## Data model and concurrency

| Table | Purpose |
| --- | --- |
| users | Attendee, organizer or admin role and salted scrypt password verifier |
| sessions | Hashed session token, owning account and expiration |
| events | Start time, venue, seating grid, hold duration and seat limit |
| reservations | Owner, event, seats, status and hold deadline |
| claims | Exclusive active ownership of each event/seat pair |

Each command opens a PostgreSQL transaction. A transaction-scoped advisory lock serializes changes, including organizer edits and expiry cleanup. The server reads the clock after taking the lock. A composite primary key on claims(event, seat) enforces exclusivity even when clients bypass the UI. A multi-seat hold with a collision rolls back in full. Confirmation retains the claims, while cancellation releases them and preserves booking history.

At the deadline a hold expires. Every API operation reconciles overdue holds before checking availability. Open screens subscribe to a server-sent event stream. PostgreSQL signals committed changes through LISTEN/NOTIFY. Each browser reloads its authorized data on change or reconnect and schedules a refresh at the next hold deadline. If the stream disconnects, the browser retries and polls every three seconds until it reconnects. Existing holds retain their original deadline if an organizer changes the configuration. The default duration is five minutes and the maximum is four seats. The single advisory lock deliberately limits throughput in this demo.

## Tests and demo

Install Google Chrome for the Playwright browser test. Run the following commands sequentially.

    npm run build
    npm test
    npm run test:browser

The suite starts a disposable PostgreSQL cluster on loopback port 55439 and removes its own test data when finished. Tests use separate connections for competing requests and an injected clock for the exact expiry boundary. They also cover seed counts, all-or-nothing holds, ownership, permissions, configuration and cancellation.

For the live demo, sign in as two different attendees in separate browser sessions, hold a seat in the first and observe the second window update. Confirm and cancel from My bookings. Sign in as organizer to edit an event and try the new limit in the attendee window.

[Five-minute narrated Stagepass demo](Stagepass-Demo-5min.mp4)
## Vercel deployment

Run `npm run build`, then `node scripts/vercel-package.mjs`. Deploy the generated `dist/vercel` directory with the Vercel CLI. It contains the compiled Angular site, NestJS function, and database schema. Local databases, passwords, and recordings stay outside the package.

Set production environment variables DATABASE_URL (the hosted PostgreSQL connection string) and STAGE_ORGANIZER_PASSWORD (the first-time organizer password) in Vercel, then redeploy. Verify that an attendee can load events, hold a seat, and cancel the hold.

## Administrator access

Sign in from Account with username **admin**. Set STAGE_ADMIN_PASSWORD before the first deployment that provisions the administrator. The local embedded demo uses LocalAdminDemo2026! by default. Production uses the separate password configured in Vercel. The Admin panel lists registered accounts and creates organizer logins. Only organizers manage event seating and booking rules. Public sign-up always creates attendees.

Live notifications share one PostgreSQL listener per active API instance. With a Supabase shared transaction pooler URL on port 6543, the listener uses the matching session endpoint on port 5432. For other transaction poolers, set LISTEN_DATABASE_URL to a session-capable connection.

## Google sign-in

Stagepass keeps password-based sign-up and sign-in for existing accounts. Google sign-in uses the Supabase Google OAuth provider and PKCE, followed by a Stagepass session. First-time Google users receive an attendee account. Returning users are matched by their stable Google identity. Password accounts and privileged accounts are never linked automatically by a matching name or email.

1. In Google Cloud create a Web OAuth client. Add the OAuth callback URL shown in the new Supabase project's Google provider settings as an authorized redirect URI.
2. In Supabase Authentication, enable Google and enter the Google client ID and client secret. Under URL Configuration, allow the Stagepass redirect URL https://stagepass-seat-booking.vercel.app/.
3. In Vercel Production set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY from that same project and ensure DATABASE_URL points to its working PostgreSQL database. Redeploy.
4. For a custom domain or local preview, set STAGE_AUTH_REDIRECT_URL to that exact app root and allow it in Supabase.

Provider setup: https://supabase.com/docs/guides/auth/social-sign-in/auth-google

## Event discovery and browser tests

The public agenda ranks current event metadata and curated program tags against a visitor's preference using TF-IDF cosine similarity. New events participate through their titles, venues and genres. Preferences stay in the browser. The five additional production programs have locally bundled illustrative photographs from Unsplash. The original two-event seed supports reproducible testing.

On the seat map, choose a group size and preferred rows, then click **Suggest seats**. The search considers adjacent available seats on the same side of an aisle and ranks candidates by row preference and distance from the centre. Clicking **Hold seats** still goes through the database concurrency check.

With Google Chrome installed, run npm run test:browser after the build. This uses a disposable PostgreSQL instance and a local server on port 8137. Run the database and browser suites sequentially when using the default test port.

[Recorded Playwright test result](test-results/playwright.txt) · [Database test results](test-results/database.txt)
