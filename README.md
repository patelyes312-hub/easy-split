# EasySplit Live

A live, multi-device expense splitter. No `npm install` is required — Node only serves the static files. Supabase provides authentication, the cloud database, and realtime updates.

## Setup

1. Create a Supabase project.
2. Open **SQL Editor**, paste all of `supabase.sql`, and run it. The script is safe to re-run.
3. In **Project Settings > Data API**, copy the **Project URL** and the **publishable** (anon) key.
4. Paste both into `config.js`.
5. In **Authentication > Providers > Email**, either turn off **Confirm email** for quick testing, or confirm each registration email before signing in.
6. In **Authentication > URL Configuration**, add your site URL (e.g. `http://localhost:3002` and your deployed URL).
7. Run `node server.js` and open `http://localhost:3002`.

> The server listens on port **3002** by default. Override it with `PORT=4000 node server.js` if needed.

## Using the app

- **Create an account**, then sign in. On first sign-in a profile row is created automatically.
- **+ New group** creates a group. The creator becomes the group **owner** (the approver).
- **+ Invite member** (Members tab) invites another registered user by email. They join as **pending**.
- **Add expense** records an expense, picks who paid, and splits it equally between selected active members.
- **Overview tab** shows settle-up suggestions and each member's net balance, recalculated live.
- **Download CSV** exports the current group's expenses.

## Member approval

Access to a group is controlled by its **owner** (the person who created it).

- When the owner invites someone, that person joins as **pending** and cannot see the group's expenses or balances yet.
- The owner sees pending requests in the group's **Members** tab, with **Approve** and **Reject** buttons.
- Once approved, the member becomes **active**: the group appears on their dashboard and they can take part in expenses.
- The owner can also **Remove** an active member. The owner cannot be removed.

So if a new user (for example Sagar or Malay) is invited, **Yash — as the group owner — must approve them** before they get access.

## Testing live updates

Open two browser profiles and register two accounts. From the first account, create a group and add the second account by its registered email. Open that group in both browsers. Adding an expense in one updates the other within a second.

## Troubleshooting login

- **The form does nothing / "Open config.js…" message**: `config.js` still has placeholder values, or the page was not reloaded after editing it. Paste the real URL and publishable key and reload.
- **"Invalid login credentials"**: wrong email/password, or the account email has not been confirmed. Confirm the email or disable **Confirm email** while testing.
- **"Check your email to confirm"** after sign-up: email confirmation is on. Confirm the link, then sign in.
- **Signed in but "profile is not set up yet"**: the `new_user` trigger did not run (usually because `supabase.sql` was not fully executed). Re-run `supabase.sql`, then sign out and in again.
- **Nothing loads after sign-in / row-level security errors**: make sure the entire `supabase.sql` ran without errors so the RLS policies and `member_of` function exist.
- **Approve/Reject buttons don't appear, or invites don't go pending**: re-run `supabase.sql` so the `status`/`role` columns and the `approve_group_member` / `remove_group_member` functions exist. The script is safe to re-run and backfills existing data.
- **An invited user can't see the group**: that's expected until the owner approves them in the Members tab.
- **CORS / redirect errors**: add your site URL under **Authentication > URL Configuration**.

## Deploying to Vercel

Deploy the folder as a static site. Add the deployed URL under **Supabase > Authentication > URL Configuration**. `config.js` holds only the public publishable key — never put a service-role key there.
