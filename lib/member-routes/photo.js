import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { withKittyDatabase } from '../db.js';
import { json, jsonBody, memberForRequest } from '../member-api.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const base64 = /^[A-Za-z0-9+/]+={0,2}$/;

export async function prepareFacePhoto(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 2_800_000 || encoded.length % 4 !== 0 || !base64.test(encoded)) throw new Error('invalid_photo');
  const input = Buffer.from(encoded, 'base64');
  if (!input.length || input.length > 2_097_152) throw new Error('invalid_photo');
  const image = sharp(input, { limitInputPixels: 20_000_000, failOn: 'error', animated: false });
  const metadata = await image.metadata();
  if (!['jpeg', 'png', 'webp'].includes(metadata.format) || !metadata.width || !metadata.height || metadata.pages > 1) throw new Error('invalid_photo');
  const content = await image.rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82, effort: 4 }).toBuffer();
  if (!content.length || content.length > 2_097_152) throw new Error('photo_too_large');
  return content;
}

export default async function handler(req, res) {
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) return json(res, 405, { error: 'method_not_allowed' });
  const member = await memberForRequest(req, res, { write: req.method !== 'GET' });
  if (!member) return;
  if (req.method === 'DELETE') {
    try {
      await withKittyDatabase(async client => {
        await client.query('begin');
        try {
          await client.query('select id from kitty_private.members where id=$1 and deleted_at is null for update', [member.id]);
          await client.query(`update kitty_private.join_requests set status='cancelled',review_profile=null,decided_at=now()
            where member_id=$1 and status in ('requested','waitlisted')`, [member.id]);
          await client.query('update kitty_private.members set face_photo_key=null where id=$1', [member.id]);
          await client.query('delete from kitty_private.face_photos where owner_id=$1', [member.id]);
          await client.query('insert into kitty_private.audit_log(actor_id,action) values($1,$2)', [member.id, 'face_photo_removed']);
          await client.query('commit');
        } catch (error) { await client.query('rollback').catch(() => {}); throw error; }
      });
      return json(res, 200, { hasPhoto: false });
    } catch { return json(res, 503, { error: 'photo_unavailable' }); }
  }
  if (req.method === 'POST') {
    try {
      const body = jsonBody(req, 3_000_000);
      const content = await prepareFacePhoto(body.imageBase64);
      const key = `${member.id}/${randomUUID()}.webp`;
      await withKittyDatabase(async client => {
        await client.query('begin');
        try {
          const { rows } = await client.query('select id from kitty_private.members where id=$1 and deleted_at is null for update', [member.id]);
          if (!rows[0]) throw new Error('member_not_found');
          await client.query(`update kitty_private.join_requests
            set status='cancelled',review_profile=null,decided_at=now()
            where member_id=$1 and status in ('requested','waitlisted')`, [member.id]);
          await client.query(`insert into kitty_private.face_photos(owner_id,object_key,content)
            values($1,$2,$3) on conflict(owner_id) do update set object_key=excluded.object_key,content=excluded.content,updated_at=now()`, [member.id, key, content]);
          await client.query('update kitty_private.members set face_photo_key=$2 where id=$1', [member.id, key]);
          await client.query('insert into kitty_private.audit_log(actor_id,action) values($1,$2)', [member.id, 'face_photo_updated']);
          await client.query('commit');
        } catch (error) { await client.query('rollback').catch(() => {}); throw error; }
      });
      return json(res, 200, { hasPhoto: true });
    } catch (error) {
      if (['invalid_photo', 'photo_too_large', 'invalid_body', 'body_too_large'].includes(error.message)) return json(res, 400, { error: error.message });
      return json(res, 503, { error: 'photo_unavailable' });
    }
  }
  const requestId = req.query?.requestId;
  if (requestId && !uuid.test(requestId)) return json(res, 400, { error: 'invalid_request' });
  if (requestId && (!member.adultAttested || !member.womenOnlyAttested || member.identityStatus !== 'verified' || member.accessStatus !== 'active')) return json(res, 403, { error: 'membership_not_ready' });
  try {
    const { rows } = await withKittyDatabase(client => requestId ? client.query(`
      select p.content from kitty_private.join_requests r
      join kitty_private.join_vote_electorate e on e.request_id=r.id and e.voter_id=$2
      join kitty_private.group_memberships gm on gm.group_id=r.group_id and gm.member_id=$2 and gm.status='active'
      join kitty_private.face_photos p on p.owner_id=r.member_id and p.object_key=(r.review_profile->>'photoKey')
      where r.id=$1 and r.status in ('requested','waitlisted') and r.profile_share_consent_at is not null
        and not exists(select 1 from kitty_private.blocks b where
          (b.actor_id=$2 and b.target_id=r.member_id) or (b.actor_id=r.member_id and b.target_id=$2))
    `, [requestId, member.id]) : client.query(`
      select p.content from kitty_private.face_photos p
      join kitty_private.members m on m.id=p.owner_id and m.face_photo_key=p.object_key
      where p.owner_id=$1 and m.deleted_at is null
    `, [member.id]));
    if (!rows[0]) return json(res, 404, { error: 'photo_not_found' });
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    return res.status(200).end(rows[0].content);
  } catch { return json(res, 503, { error: 'photo_unavailable' }); }
}
