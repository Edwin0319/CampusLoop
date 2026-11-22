import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { emptyListing, filterListings, listingPayload, seedListings, validSlot } from '../src/model.js';

test('discovery combines a search, category, transfer mode, and visibility', () => {
  const hidden = { ...seedListings.find(item => item.kind === 'request'), id: 'private', audience: 'private' };
  const rows = filterListings([...seedListings, hidden], { kind: 'request', category: 'study', mode: 'free', query: '  dÉsk  lamp  ' });
  assert.deepEqual(rows.map(item => item.title), ['Free desk lamp for studying']);
  assert.equal(validSlot({ date: '2026-02-29', start: '19:00', end: '20:00' }), false);
  assert.equal(validSlot({ date: '2028-02-29', start: '19:00', end: '20:00' }), true);
  assert.equal(validSlot({ date: '2028-02-29', start: '20:00', end: '19:00' }), false);
});

test('Postgres policies and transitions keep a cancelled offer private until the owner relists it', async () => {
  const [owner, recipient, other] = [1, 2, 3].map(number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`);
  const db = new PGlite();
  const migration = new URL('../supabase/migrations/202611220001_campus_loop.sql', import.meta.url);
  const seed = await readFile(new URL('../supabase/seed.sql', import.meta.url), 'utf8');
  const query = (sql, parameters) => db.query(sql, parameters).then(result => result.rows);
  async function as(user) {
    await db.exec('set role authenticated');
    await query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  }

  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;`);
    for (const user of [owner, recipient, other]) await query('insert into auth.users values ($1)', [user]);
    await db.exec(await readFile(migration, 'utf8'));
    await db.exec(seed);
    await db.exec(seed);
    await as(owner);
    assert.equal((await query('select id from public.listings')).length, 7);

    const payload = listingPayload({ ...emptyListing(), title: 'Test chair', description: 'Good for study',
      pickup_slots: [{ date: '2030-01-01', start: '18:00', end: '20:00' }], pickup_note: 'One day notice' });
    const [{ id }] = await query('select public.save_listing(null, $1::jsonb) as id', [JSON.stringify(payload)]);
    const [{ id: privateId }] = await query('select public.save_listing(null, $1::jsonb) as id', [JSON.stringify({ ...payload, audience: 'private' })]);

    await as(recipient);
    assert.equal((await query('select id from public.listings where id = $1', [privateId])).length, 0);
    await assert.rejects(query('select public.save_listing($1, $2::jsonb)', [id, JSON.stringify(payload)]), /not_owner/);
    await assert.rejects(query('update public.listings set status = $1 where id = $2', ['closed', id]), /permission denied/);
    const [{ transfer }] = await query("select public.propose_handover($1, current_date + 3, '18:00', 'library') as transfer", [id]);
    await query('insert into public.messages(handover_id, sender_id, body) values ($1, $2, $3)', [transfer, recipient, 'Please leave it at the library.']);
    await assert.rejects(query('select public.change_handover($1, $2)', [transfer, 'accept']), /invalid_transition/);

    await as(other);
    assert.equal((await query('select id from public.handovers where id = $1', [transfer])).length, 0);
    assert.equal((await query('select id from public.messages where handover_id = $1', [transfer])).length, 0);
    await assert.rejects(query('select public.change_handover($1, $2)', [transfer, 'cancel']), /not_participant/);

    await as(owner);
    await query('select public.change_handover($1, $2)', [transfer, 'accept']);
    await query('select public.change_handover($1, $2)', [transfer, 'place']);
    await assert.rejects(query('select public.change_handover($1, $2)', [transfer, 'receive']), /invalid_transition/);
    await as(recipient);
    await query('select public.change_handover($1, $2)', [transfer, 'cancel']);
    assert.equal((await query('select id from public.listings where id = $1', [id])).length, 0);
    await assert.rejects(query('select public.relist($1, $2)', [id, 'retrieved']), /listing_unavailable/);
    await assert.rejects(query('insert into public.messages(handover_id, sender_id, body) values ($1,$2,$3)', [transfer, recipient, 'Too late']), /row-level security/);

    await as(owner);
    await assert.rejects(query('select public.relist($1, $2)', [id, 'has']), /confirm_possession/);
    await query('select public.relist($1, $2)', [id, 'retrieved']);
    const [listing] = await query('select status, audience, pickup_slots from public.listings where id = $1', [id]);
    assert.deepEqual(listing, { status: 'available', audience: 'campus', pickup_slots: payload.pickup_slots });
    assert.equal((await query('select status from public.handovers where id = $1', [transfer]))[0].status, 'cancelled');
    assert.equal((await query('select body from public.messages where handover_id = $1', [transfer])).length, 1);
    const [sample] = await query('select public.seed_recovery() as id');
    assert.deepEqual((await query('select public.seed_recovery() as id'))[0], sample);
    await as(other);
    assert.equal((await query('select id from public.listings where id = $1', [sample.id])).length, 0);
  } finally { await db.close(); }
});
