import { withKittyDatabase } from '../lib/db.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const result = await withKittyDatabase(async client => {
      const groups = await client.query(`
        select g.id, g.title, g.description, g.public_city as city,
               g.member_limit as member_limit,
               count(m.id)::int as members
        from kitty_private.groups g
        left join kitty_private.group_memberships m
          on m.group_id = g.id and m.status = 'active'
        where g.visibility = 'discoverable' and g.deleted_at is null
        group by g.id
        order by g.created_at desc
        limit 24
      `);
      const sessions = await client.query(`
        select e.id, e.group_id, e.title, e.theme, e.starts_at,
               g.title as group_title, g.public_city as city,
               e.capacity - count(r.member_id) filter (where r.response = 'going')::int as available
        from kitty_private.events e
        join kitty_private.groups g on g.id = e.group_id and g.deleted_at is null
        left join kitty_private.event_rsvps r on r.event_id = e.id
        where e.scope = 'open' and e.status = 'scheduled' and e.starts_at > now()
        group by e.id, g.id
        order by e.starts_at
        limit 24
      `);
      return {
        groups: groups.rows.map(g => ({ id: g.id, title: g.title, description: g.description, city: g.city, members: g.members, limit: g.member_limit, available: Math.max(0, g.member_limit - g.members) })),
        sessions: sessions.rows.map(s => ({ id: s.id, groupId: s.group_id, title: s.title, theme: s.theme, startsAt: s.starts_at, groupTitle: s.group_title, city: s.city, available: Math.max(0, s.available) })),
      };
    });
    return res.status(200).json(result);
  } catch {
    return res.status(503).json({ error: 'public_discovery_unavailable' });
  }
}
