import profile from '../lib/member-routes/profile.js';
import create from '../lib/member-routes/create.js';
import apply from '../lib/member-routes/apply.js';
import review from '../lib/member-routes/review.js';
import vote from '../lib/member-routes/vote.js';
import override from '../lib/member-routes/override.js';
import { json } from '../lib/member-api.js';

const routes = { profile, create, apply, review, vote, override };

export default async function handler(req, res) {
  const route = req.query?.route;
  if (typeof route !== 'string' || !Object.hasOwn(routes, route)) return json(res, 404, { error: 'route_not_found' });
  return routes[route](req, res);
}
