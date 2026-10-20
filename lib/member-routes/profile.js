import { withKittyDatabase } from '../db.js';
import { json, jsonBody, memberForRequest, shortText } from '../member-api.js';

const handle = value => {
  const clean = shortText(value || '', 41).replace(/^@/, '');
  if (clean && !/^[A-Za-z0-9._-]{1,40}$/.test(clean)) throw new Error('invalid_social_handle');
  return clean || null;
};

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'method_not_allowed' });
  const member = await memberForRequest(req, res, { write: req.method === 'POST' });
  if (!member) return;
  try {
    if (req.method === 'POST') {
      const body = jsonBody(req);
      const bio = shortText(body.bio || '', 500);
      const instagram = handle(body.instagram || '');
      const facebook = handle(body.facebook || '');
      const snapchat = handle(body.snapchat || '');
      await withKittyDatabase(client => client.query(
        'update kitty_private.members set profile_bio=$2, instagram_handle=$3, facebook_handle=$4, snapchat_handle=$5 where id=$1 and deleted_at is null',
        [member.id, bio, instagram, facebook, snapchat],
      ));
    }
    const { rows } = await withKittyDatabase(client => client.query(
      'select display_name,profile_bio,instagram_handle,facebook_handle,snapchat_handle,face_photo_key is not null as has_photo,whatsapp_verified_at is not null as whatsapp_verified from kitty_private.members where id=$1 and deleted_at is null',
      [member.id],
    ));
    if (!rows[0]) return json(res, 404, { error: 'member_not_found' });
    const p = rows[0];
    return json(res, 200, { profile: { name: p.display_name, bio: p.profile_bio, socials: { instagram: p.instagram_handle, facebook: p.facebook_handle, snapchat: p.snapchat_handle }, hasPhoto: p.has_photo, whatsappVerified: p.whatsapp_verified } });
  } catch (error) {
    if (['invalid_body', 'body_too_large', 'invalid_text', 'invalid_social_handle'].includes(error.message)) return json(res, 400, { error: error.message });
    return json(res, 503, { error: 'profile_unavailable' });
  }
}
