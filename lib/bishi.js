import { createHash, randomBytes } from 'node:crypto';

export const bishiEnabled = () => process.env.KITTY_BISHI_ENABLED === 'true';

export function newDrawSeed() {
  const secret = randomBytes(32).toString('hex');
  return { secret, commitment: createHash('sha256').update(secret, 'hex').digest('hex') };
}

export function drawWinner(secret, commitment, planId, roundNumber, participants, previousWinners = []) {
  if (!/^[0-9a-f]{64}$/.test(secret) || createHash('sha256').update(secret, 'hex').digest('hex') !== commitment) throw new Error('invalid_draw_seed');
  if (!Number.isInteger(roundNumber) || roundNumber < 1 || roundNumber > 100) throw new Error('invalid_round');
  const candidates = [...new Set(participants)].filter(id => !previousWinners.includes(id)).sort();
  if (!candidates.length || candidates.length !== participants.length - previousWinners.length) throw new Error('invalid_candidates');
  const size = BigInt(candidates.length);
  const ceiling = 1n << 256n;
  const limit = ceiling - (ceiling % size);
  for (let nonce = 0; nonce < 1000; nonce++) {
    const hash = createHash('sha256').update(`kitty-bishi-v1:${secret}:${planId}:${roundNumber}:${candidates.join(',')}:${nonce}`).digest('hex');
    const value = BigInt(`0x${hash}`);
    if (value < limit) return candidates[Number(value % size)];
  }
  throw new Error('draw_unavailable');
}

export function scheduledRound(startsOn, cadence, index) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !['weekly','fortnightly','monthly'].includes(cadence) || !Number.isInteger(index) || index < 0 || index > 99) throw new Error('invalid_schedule');
  const start = new Date(`${startsOn}T12:00:00Z`);
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0,10) !== startsOn) throw new Error('invalid_schedule');
  if (cadence === 'monthly') {
    const year = start.getUTCFullYear();
    const month = start.getUTCMonth() + index;
    const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(start.getUTCDate(), last))).toISOString().slice(0,10);
  }
  start.setUTCDate(start.getUTCDate() + index * (cadence === 'weekly' ? 7 : 14));
  return start.toISOString().slice(0,10);
}
