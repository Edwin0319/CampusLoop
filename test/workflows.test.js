import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { emptyListing, filterListings, handoverPlaceLabel, listingPayload, seedListings, validSlot } from '../src/model.js';

test('discovery combines a search, category, transfer mode, and visibility', () => {
  const hidden = { ...seedListings.find(item => item.kind === 'request'), id: 'private', audience: 'private' };
  const rows = filterListings([...seedListings, hidden], { kind: 'request', category: 'study', mode: 'free', query: '  dÉsk  lamp  ' });
  assert.deepEqual(rows.map(item => item.title), ['Free desk lamp for studying']);
  for (const kind of ['offer', 'request']) {
    const sample = seedListings.find(item => item.kind === kind);
    const ownPost = { ...sample, id: 'own-post', owner_id: 'student-a', simulated: false };
    const filters = { kind, category: sample.category, mode: sample.mode, query: sample.title };
    assert.deepEqual(filterListings([ownPost, sample], filters, 'student-a').map(item => item.id), [sample.id]);
    assert.deepEqual(filterListings([ownPost, sample], filters, 'student-b').map(item => item.id), ['own-post', sample.id]);
  }
  assert.equal(validSlot({ date: '2026-02-29', start: '19:00', end: '20:00' }), false);
  assert.equal(validSlot({ date: '2028-02-29', start: '19:00', end: '20:00' }), true);
  assert.equal(validSlot({ date: '2028-02-29', start: '20:00', end: '19:00' }), false);
  assert.equal(handoverPlaceLabel('library', () => '圖書館正門'), '圖書館正門');
  assert.equal(handoverPlaceLabel('Library, west lobby', () => 'Unrelated label'), 'Library, west lobby');
});

test('Postgres enforces handover transitions, editable locations, and private replies', async () => {
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
    const locationMigration = await readFile(new URL('../supabase/migrations/202611230001_editable_handover_location.sql', import.meta.url), 'utf8');
    await db.exec(locationMigration);
    await db.exec(locationMigration);
    const repliesMigration = await readFile(new URL('../supabase/migrations/202611230002_request_replies.sql', import.meta.url), 'utf8');
    await db.exec(repliesMigration);
    await db.exec(repliesMigration);
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
    const propose = "select public.propose_handover($1, current_date + 3, '18:00', $2) as transfer";
    for (const invalidPlace of ['', '   ', 'a'.repeat(101), 'Library\nLobby']) {
      await assert.rejects(query(propose, [id, invalidPlace]), /handovers_place_text_check/);
    }
    const customPlace = '圖書館地下大堂 / Library lobby';
    const [{ transfer }] = await query(propose, [id, customPlace]);
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
    assert.deepEqual((await query('select status, place from public.handovers where id = $1', [transfer]))[0],
      { status: 'cancelled', place: customPlace });
    assert.equal((await query('select body from public.messages where handover_id = $1', [transfer])).length, 1);
    const [sample] = await query('select public.seed_recovery() as id');
    assert.deepEqual((await query('select public.seed_recovery() as id'))[0], sample);
    assert.equal((await query('select place from public.handovers where listing_id = $1', [sample.id]))[0].place, 'library');
    await as(other);
    assert.equal((await query('select id from public.listings where id = $1', [sample.id])).length, 0);

    await as(owner);
    const request = listingPayload({ ...emptyListing(), kind: 'request', title: 'Wanted: reading lamp', description: 'For studying' });
    const [{ id: requestId }] = await query('select public.save_listing(null, $1::jsonb) as id', [JSON.stringify(request)]);
    const [{ id: privateRequestId }] = await query('select public.save_listing(null, $1::jsonb) as id', [JSON.stringify({ ...request, audience: 'private' })]);
    const sendReply = 'select public.send_request_reply($1, $2, $3, $4) as id';
    const response = ['A private lamp offer', 'USB lamp in working order', null];
    await assert.rejects(query(sendReply, [requestId, ...response]), /request_unavailable/);

    await as(recipient);
    await assert.rejects(query(sendReply, [privateRequestId, ...response]), /request_unavailable/);
    await assert.rejects(query(sendReply, [id, ...response]), /request_unavailable/);
    await assert.rejects(query(sendReply, [requestId, ...response.slice(0, 2), 30]), /check constraint/);
    const [{ id: replyId }] = await query(sendReply, [requestId, ...response]);
    assert.equal((await query('select request_id from public.request_replies where id = $1', [replyId]))[0].request_id, requestId);
    assert.equal((await query('select id from public.listings where title = $1', [response[0]])).length, 0);

    await as(other);
    assert.equal((await query('select id from public.request_replies where id = $1', [replyId])).length, 0);
    await as(owner);
    assert.equal((await query('select item_title from public.request_replies where id = $1', [replyId]))[0].item_title, response[0]);
  } finally { await db.close(); }
});
