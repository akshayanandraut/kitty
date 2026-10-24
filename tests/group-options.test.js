import test from 'node:test';
import assert from 'node:assert/strict';
import { groupOptions, groupTitle, needsAudienceConfirmation } from '../lib/group-options.js';
import { currentKyc } from '../lib/auth.js';

test('group title keeps faith labels in audience settings, not the name', () => {
  assert.equal(groupTitle('  Moonlight   Circle  '), 'Moonlight Circle');
  for (const name of ['Muslim Moonlight', 'Hindu brunch', 'Christian women', 'हिंदू साथी', 'इस्लाम क्लब']) {
    assert.throws(() => groupTitle(name), /invalid_group_name/, name);
  }
  assert.equal(groupTitle('Beach & Brunch'), 'Beach & Brunch');
});

test('audience and outfit filters accept only declared options', () => {
  assert.deepEqual(groupOptions({ faithFocus:'catholic', communitySpace:'lesbian', regionFocus:'northeast_india', styleTags:['saree','modest'] }), {
    faithFocus:'catholic', communitySpace:'lesbian', regionFocus:'northeast_india', styleTags:['saree','modest'],
  });
  assert.equal(needsAudienceConfirmation(groupOptions({ communitySpace:'lesbian' })), true);
  assert.equal(needsAudienceConfirmation(groupOptions()), false);
  for (const input of [{ faithFocus:'bogus' }, { regionFocus:'bogus' }, { styleTags:['bold','bold'] }, { styleTags:['saree','party','active','beach'] }, { styleTags:'saree' }]) {
    assert.throws(() => groupOptions(input), /invalid_group_options/);
  }
});

test('KYC requires a recorded current decision and consent versions', () => {
  const now = new Date('2026-10-24T10:00:00Z');
  const valid = { identity_status:'verified', identity_checked_at:'2026-10-23T10:00:00Z', identity_expires_at:'2027-10-23T10:00:00Z', identity_version:'provider-v1', identity_consent_version:'v1' };
  assert.equal(currentKyc(valid, now), true);
  for (const change of [{identity_status:'pending'}, {identity_checked_at:null}, {identity_expires_at:'2026-10-24T10:00:00Z'}, {identity_version:null}, {identity_consent_version:''}]) {
    assert.equal(currentKyc({ ...valid, ...change }, now), false);
  }
});
