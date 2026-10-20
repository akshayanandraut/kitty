# Kitty

Kitty is a women-only group planning and money-recording product. This repository currently contains a **local development slice**. The sample accounts and groups are synthetic. There is no public deployment, real KYC, payment collection, or real money transfer.

Run `npm test`, then `npm run dev` and open `http://127.0.0.1:4173`. Local demo identities are accepted only when `KITTY_LOCAL_DEMO=1` and the server binds to loopback. Data persists in `data/kitty.json`; remove that file to reset sample data. This mode must never be enabled in a public deployment.

Production requests fail closed until Grasany PKCE SSO, dedicated Supabase persistence, central identity verification, the approved one-time payment contract, and exact hosting/domain configuration are connected and tested. Identity verification does not establish gender or safety. Women-only eligibility is self-attested and subject to moderation.

## Current local flows

- Public discovery shows only opt-in public group summaries and available slots.
- Members can create groups, request or accept invitations, approve or decline requests, join a waitlist, and belong to multiple groups.
- Group members can schedule events and RSVP, record member-defined contribution obligations and payments, enter shared expenses with exact integer-paise splits, and record settlements. These are records only.
- Hosts can rotate, set rules, and remove members. Members can report or block users. Contact details are shared only by explicit consent within an authorized group.
- Members can export their own record snapshot or request local account deletion.

The local API keeps a serialized transaction queue and writes snapshots atomically. It is a development adapter, not a production database. `supabase/migrations/` holds a draft dedicated-database schema for later review and deployment. No migration has been applied remotely.
