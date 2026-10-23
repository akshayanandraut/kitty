import profile from '../lib/member-routes/profile.js';
import create from '../lib/member-routes/create.js';
import apply from '../lib/member-routes/apply.js';
import review from '../lib/member-routes/review.js';
import vote from '../lib/member-routes/vote.js';
import override from '../lib/member-routes/override.js';
import photo from '../lib/member-routes/photo.js';
import home from '../lib/member-routes/home.js';
import group from '../lib/member-routes/group.js';
import eventCreate from '../lib/member-routes/event-create.js';
import eventRsvp from '../lib/member-routes/event-rsvp.js';
import expensePropose from '../lib/member-routes/expense-propose.js';
import expenseDecision from '../lib/member-routes/expense-decision.js';
import joinCancel from '../lib/member-routes/join-cancel.js';
import rejections from '../lib/member-routes/rejections.js';
import locationUpdate from '../lib/member-routes/location-update.js';
import leave from '../lib/member-routes/leave.js';
import bishi from '../lib/member-routes/bishi.js';
import { json } from '../lib/member-api.js';

const routes = { profile, photo, home, group, create, apply, review, vote, override, rejections,
  'location-update': locationUpdate, leave, bishi,
  'event-create': eventCreate, 'event-rsvp': eventRsvp,
  'expense-propose': expensePropose, 'expense-decision': expenseDecision,
  'join-cancel': joinCancel };

export default async function handler(req, res) {
  const route = req.query?.route;
  if (typeof route !== 'string' || !Object.hasOwn(routes, route)) return json(res, 404, { error: 'route_not_found' });
  return routes[route](req, res);
}
