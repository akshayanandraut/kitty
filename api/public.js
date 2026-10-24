import { withKittyDatabase } from '../lib/db.js';
import { discoveryQuery } from '../lib/discovery.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  let filters;
  try { filters = discoveryQuery(req.query); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  try {
    const result = await withKittyDatabase(async client => {
      const filterStart = filters.nearby ? 5 : 2;
      const faithParam = `$${filterStart}`;
      const communityParam = `$${filterStart + 1}`;
      const regionParam = `$${filterStart + 2}`;
      const styleParam = `$${filterStart + 3}`;
      const groupParams = filters.nearby
        ? [filters.search, filters.nearby.lat, filters.nearby.lon, filters.nearby.radiusKm, filters.faithFocus, filters.communitySpace, filters.regionFocus, filters.styleTag]
        : [filters.search, filters.faithFocus, filters.communitySpace, filters.regionFocus, filters.styleTag];
      const distance = `6371 * acos(least(1, greatest(-1,
        sin(radians($2::double precision)) * sin(radians(g.public_latitude::double precision)) +
        cos(radians($2::double precision)) * cos(radians(g.public_latitude::double precision)) *
        cos(radians(g.public_longitude::double precision - $3::double precision)))))`;
      const groups = await client.query(`
        select g.id, g.title, g.description, g.public_city as city,
               g.public_area as area,g.member_limit as member_limit,
               g.avg_monthly_cost_paise, g.expense_split_basis,g.faith_focus,g.community_space,g.region_focus,g.style_tags,
               count(m.id)::int as members,
               ${filters.nearby ? `${distance} as distance_km` : 'null::double precision as distance_km'}
        from kitty_private.groups g
        left join kitty_private.group_memberships m
          on m.group_id = g.id and m.status = 'active'
        where g.visibility = 'discoverable' and g.deleted_at is null
          and ($1::text = '' or lower(g.public_city || ' ' || g.public_area || ' ' || g.title) like '%' || lower($1) || '%')
          and (${faithParam}::text = 'any' or g.faith_focus = ${faithParam})
          and (${communityParam}::text = 'all' or g.community_space = ${communityParam})
          and (${regionParam}::text = 'any' or g.region_focus = ${regionParam})
          and (${styleParam}::text = 'any' or ${styleParam} = any(g.style_tags))
          ${filters.nearby ? `and g.public_latitude is not null and ${distance} <= $4::double precision` : ''}
        group by g.id
        order by ${filters.nearby ? 'distance_km asc,g.created_at desc' : 'g.created_at desc'}
        limit 50
      `, groupParams);
      const sessions = await client.query(`
        select e.id, e.group_id, e.title, e.theme, e.starts_at,
               g.title as group_title, g.public_city as city,g.faith_focus,g.community_space,g.region_focus,g.style_tags,
               e.capacity - count(r.member_id) filter (where r.response = 'going')::int as available
        from kitty_private.events e
        join kitty_private.groups g on g.id = e.group_id and g.deleted_at is null
        left join kitty_private.event_rsvps r on r.event_id = e.id
        where e.scope = 'open' and e.status = 'scheduled' and e.starts_at > now()
          and ($1::text = '' or lower(g.public_city || ' ' || g.public_area || ' ' || g.title || ' ' || e.title) like '%' || lower($1) || '%')
          and ($2::text = 'any' or g.faith_focus = $2)
          and ($3::text = 'all' or g.community_space = $3)
          and ($4::text = 'any' or g.region_focus = $4)
          and ($5::text = 'any' or $5 = any(g.style_tags))
        group by e.id, g.id
        order by e.starts_at
        limit 24
      `, [filters.search, filters.faithFocus, filters.communitySpace, filters.regionFocus, filters.styleTag]);
      return {
        groups: groups.rows.map(g => ({ id: g.id, title: g.title, description: g.description, city: g.city, area: g.area, distanceKm: g.distance_km === null ? null : Math.round(Number(g.distance_km) * 10) / 10, members: g.members, limit: g.member_limit, available: Math.max(0, g.member_limit - g.members), avgMonthlyCostPaise: g.avg_monthly_cost_paise, expenseSplitBasis: g.expense_split_basis, faithFocus: g.faith_focus, communitySpace: g.community_space, regionFocus: g.region_focus, styleTags: g.style_tags })),
        sessions: sessions.rows.map(s => ({ id: s.id, groupId: s.group_id, title: s.title, theme: s.theme, startsAt: s.starts_at, groupTitle: s.group_title, city: s.city, available: Math.max(0, s.available), faithFocus: s.faith_focus, communitySpace: s.community_space, regionFocus: s.region_focus, styleTags: s.style_tags })),
      };
    });
    return res.status(200).json(result);
  } catch {
    return res.status(503).json({ error: 'public_discovery_unavailable' });
  }
}
