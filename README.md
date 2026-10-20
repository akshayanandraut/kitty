# Kitty

Kitty is a women-only group planning and money-recording product. This repository currently contains a **local development slice**. The sample accounts and groups are synthetic. There is no public deployment, real KYC, payment collection, or real money transfer.

Run `npm test`, then `npm run dev` and open `http://127.0.0.1:4173`. Local demo identities are accepted only when `KITTY_LOCAL_DEMO=1` and the server binds to loopback. Data persists in `data/kitty.json`; remove that file to reset sample data. This mode must never be enabled in a public deployment.

Production requests fail closed until Grasany PKCE SSO, dedicated Supabase persistence, central identity verification, the approved one-time payment contract, and exact hosting/domain configuration are connected and tested. Identity verification does not establish gender or safety. Women-only eligibility is self-attested and subject to moderation.

`npm run build` prepares the public Vercel preview in `dist/`. The hosted `/api/status` function declares account access, verification, group operations and checkout closed. The public page describes planned workflows but does not accept real member data. Git auto-deploy is disabled so publication uses a reviewed, explicit deployment to Kitty's single Vercel project.

## Current local flows

- Public discovery shows only opt-in public group summaries and available slots.
- Hosts can open a future meetup to newcomers. Public previews show city, time, theme and capacity, while venue and reservation details stay among members. An optional random suggestion requires a click and can be declined before any join request.
- Members can create groups, request or accept invitations, approve or decline requests, join a waitlist, and belong to multiple groups.
- Group members can schedule events and RSVP, record member-defined contribution obligations and payments, enter shared expenses with exact integer-paise splits, and record settlements. These are records only.
- Hosts can rotate and set rules. Members can report or block users. Contact details are shared only by explicit consent within an authorized group. Member removal and report resolution are not yet implemented.
- A hosting cycle records the assigned event host, completed hosting and explicit exceptions. Cancelled meetings never count as hosted. The next cycle starts only after all current participants have hosted or have an exception. Exception approval is currently a single group-host action; a multi-member approval rule is pending.
- Members can export their own record snapshot or request local account deletion.

The local API keeps a serialized transaction queue and writes snapshots atomically. It is a development adapter, not a production database. `supabase/migrations/` holds a draft dedicated-database schema for later review and deployment. No migration has been applied remotely. Production code still needs authenticated Grasany SSO, tenant-safe Postgres transactions and access policies, the central identity status projection, host moderation, payment confirmation, protected heartbeat, and deployment verification.
