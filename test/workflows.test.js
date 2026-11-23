import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { emptyListing, filterListings, handoverPlaceLabel, listingPayload, seedListings, slotEnded, validSlot } from '../src/model.js';

test('discovery combines a search, category, transfer mode, and visibility', () => {
  const hidden = { ...seedListings.find(item => item.kind === 'request'), id: 'private', audience: 'private' };
  const rows = filterListings([...seedListings, hidden], { kind: 'request', categories: ['study'], mode: 'free', query: '  dÉsk  lamp  ' });
  assert.deepEqual(rows.map(item => item.title), ['Free desk lamp for studying']);
  for (const kind of ['offer', 'request']) {
    const sample = seedListings.find(item => item.kind === kind);
    const ownPost = { ...sample, id: 'own-post', owner_id: 'student-a', simulated: false };
    const filters = { kind, categories: [sample.category], mode: sample.mode, query: sample.title };
    assert.deepEqual(filterListings([ownPost, sample], filters, 'student-a').map(item => item.id), [sample.id]);
    assert.deepEqual(filterListings([ownPost, sample], filters, 'student-b').map(item => item.id), ['own-post', sample.id]);
  }
  const collegeOffer = { ...seedListings[0], id: 'college-offer', audience: 'college', college: 'cytc' };
  const allOffers = { kind: 'offer', categories: [], mode: '', query: '' };
  assert.equal(filterListings([collegeOffer], allOffers, 'viewer').length, 0);
  assert.equal(filterListings([collegeOffer], allOffers, 'viewer', 'mlc').length, 0);
  assert.equal(filterListings([collegeOffer], allOffers, 'viewer', 'cytc').length, 1);
  assert.equal(validSlot({ date: '2026-02-29', start: '19:00', end: '20:00' }), false);
  assert.equal(validSlot({ date: '2028-02-29', start: '19:00', end: '20:00' }), true);
  assert.equal(validSlot({ date: '2028-02-29', start: '20:00', end: '19:00' }), false);
  const noonInMacau = new Date('2026-11-23T12:00:00+08:00');
  assert.equal(slotEnded({ date: '2026-01-01', start: '09:00', end: '10:00' }, noonInMacau), true);
  assert.equal(slotEnded({ date: '2026-11-23', start: '10:00', end: '11:59' }, noonInMacau), true);
  assert.equal(slotEnded({ date: '2026-11-23', start: '11:00', end: '13:00' }, noonInMacau), false);
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
    // Apply every later migration twice (they must be re-runnable), then seed, as the README describes.
    for (const name of ['202611230003_listing_categories', '202611230004_delete_listing', '202611230005_withdraw_request_reply',
      '202611230006_college_audience', '202611230007_report3_alignment']) {
      const sql = await readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
      await db.exec(sql);
      await db.exec(sql);
    }
    await db.exec(seed);
    await db.exec(seed);
    await as(owner);
    assert.equal((await query('select id from public.listings')).length, 7);

    const payload = listingPayload({ ...emptyListing(), title: 'Test chair', description: 'Good for study', categories: ['furniture', 'study', 'otherItems'],
      condition: 'working', pickup_slots: [{ date: '2020-01-01', start: '18:00', end: '20:00' }, { date: '2030-01-01', start: '18:00', end: '20:00' }],
      pickup_note: 'One day notice' });
    const [{ id }] = await query('select public.save_listing(null, $1::jsonb) as id', [JSON.stringify(payload)]);
    const [savedListing] = await query('select category, categories from public.listings where id = $1', [id]);
    assert.deepEqual(savedListing, { category: 'furniture', categories: ['furniture', 'study', 'otherItems'] });
    assert.equal(filterListings([{ ...payload, status: 'available' }], { kind: 'offer', categories: ['kitchen', 'otherItems'], query: '' }).length, 1);
    await assert.rejects(query('select public.save_listing(null, $1::jsonb)', [JSON.stringify({ ...payload, categories: ['furniture', 'invalid'] })]), /listings_categories_check/);
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
    // Relisting keeps details and audience but drops the pickup time that has passed.
    assert.deepEqual(listing, { status: 'available', audience: 'campus', pickup_slots: [payload.pickup_slots[1]] });
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
    const sendReply = 'select public.send_request_reply($1, $2, $3, $4, $5, $6) as id';
    const response = ['A private lamp offer', 'USB lamp in working order', null, 'working', ''];
    await assert.rejects(query(sendReply, [requestId, ...response]), /request_unavailable/);

    await as(recipient);
    await assert.rejects(query(sendReply, [privateRequestId, ...response]), /request_unavailable/);
    await assert.rejects(query(sendReply, [id, ...response]), /request_unavailable/);
    await assert.rejects(query(sendReply, [requestId, ...response.slice(0, 2), 30, 'working', '']), /check constraint/);
    await assert.rejects(query(sendReply, [requestId, ...response.slice(0, 3), null, '']), /condition_required/);
    await assert.rejects(query(sendReply, [requestId, ...response.slice(0, 3), 'hasDefects', ' ']), /condition_required/);
    const [{ id: replyId }] = await query(sendReply, [requestId, ...response]);
    assert.equal((await query('select request_id from public.request_replies where id = $1', [replyId]))[0].request_id, requestId);
    assert.equal((await query('select id from public.listings where title = $1', [response[0]])).length, 0);

    await as(other);
    assert.equal((await query('select id from public.request_replies where id = $1', [replyId])).length, 0);
    await as(owner);
    assert.equal((await query('select item_title from public.request_replies where id = $1', [replyId]))[0].item_title, response[0]);

    const withdraw = 'select public.withdraw_request_reply($1)';
    await as(recipient);
    const [{ id: secondReply }] = await query(sendReply, [requestId, 'Second lamp offer', 'Spare lamp', null, 'hasDefects', 'Loose switch']);
    await as(other);
    await assert.rejects(query(withdraw, [secondReply]), /request_unavailable/);
    await as(owner);
    await assert.rejects(query(withdraw, [secondReply]), /request_unavailable/);
    await assert.rejects(query('delete from public.request_replies where id = $1', [secondReply]), /permission denied/);
    await as(recipient);
    await query(withdraw, [secondReply]);
    assert.equal((await query('select id from public.request_replies where id = $1', [secondReply])).length, 0);
    await assert.rejects(query(withdraw, [secondReply]), /request_unavailable/);
    await as(owner);
    assert.equal((await query('select id from public.request_replies where id = $1', [secondReply])).length, 0);
    assert.equal((await query('select id from public.request_replies where id = $1', [replyId])).length, 1);
    await as(owner);
    const deleteListing = 'select public.delete_listing($1)';
    await assert.rejects(query('delete from public.listings where id = $1', [requestId]), /permission denied/);
    await assert.rejects(query(deleteListing, [sample.id]), /not_owner/);
    await as(recipient);
    await assert.rejects(query(deleteListing, [requestId]), /not_owner/);
    const [{ transfer: activeTransfer }] = await query(propose, [id, 'Library lobby']);
    await as(owner);
    await assert.rejects(query(deleteListing, [id]), /listing_locked/);
    await query('select public.change_handover($1, $2)', [activeTransfer, 'cancel']);
    await query(deleteListing, [id]);
    assert.equal((await query('select id from public.listings where id = $1', [id])).length, 0);
    assert.equal((await query('select id from public.handovers where listing_id = $1', [id])).length, 0);
    assert.equal((await query('select id from public.messages where handover_id = $1', [transfer])).length, 0);
    await query(deleteListing, [requestId]);
    assert.equal((await query('select id from public.request_replies where id = $1', [replyId])).length, 0);

    const saveNew = 'select public.save_listing(null, $1::jsonb) as id';
    const canSee = async listingId => (await query('select id from public.listings where id = $1', [listingId])).length === 1;
    await as(owner);
    const collegePost = listingPayload({ ...emptyListing(), title: 'Rice cooker', description: 'For the pantry', categories: ['kitchen'], condition: 'brandNew', audience: 'college' });
    await assert.rejects(query(saveNew, [JSON.stringify(collegePost)]), /college_required/);
    await assert.rejects(query("select public.set_college('unknown')"), /profiles_college_check/);
    const kettle = '5c0d7f2e-8a41-4b6e-9f3a-2d1c7e9b4a60';
    assert.equal(await canSee(kettle), false);
    await query("select public.set_college('cytc')");
    assert.equal(await canSee(kettle), true);
    // The listing takes the poster's own college, even if the payload names another one.
    const [{ id: collegeId }] = await query(saveNew, [JSON.stringify({ ...collegePost, college: 'sheac' })]);
    assert.equal((await query('select college from public.listings where id = $1', [collegeId]))[0].college, 'cytc');
    await as(recipient);
    assert.equal(await canSee(collegeId), false);
    await assert.rejects(query(propose, [collegeId, 'Pantry']), /listing_unavailable/);
    await query("select public.set_college('cytc')");
    assert.equal(await canSee(collegeId), true);
    await as(other);
    await query("select public.set_college('mlc')");
    assert.equal(await canSee(collegeId), false);
    assert.deepEqual(await query('select college from public.profiles'), [{ college: 'mlc' }]);
    await as(recipient);
    const [{ transfer: pantryTransfer }] = await query(propose, [collegeId, 'Pantry']);
    await as(owner);
    await query('select public.change_handover($1, $2)', [pantryTransfer, 'accept']);
    // Once reserved, the listing leaves the feed but both participants can still read its terms.
    await as(recipient);
    assert.equal(await canSee(collegeId), true);
    await assert.rejects(query('select public.change_handover($1, $2)', [pantryTransfer, 'hand']), /invalid_transition/);
    await as(other);
    assert.equal(await canSee(collegeId), false);
    await as(owner);
    await query('select public.change_handover($1, $2)', [pantryTransfer, 'hand']);
    assert.deepEqual((await query('select status, placed from public.handovers where id = $1', [pantryTransfer]))[0],
      { status: 'awaiting', placed: false });
    await assert.rejects(query(saveNew, [JSON.stringify({ ...collegePost, condition: 'good' })]), /listings_condition_check/);

    await as(owner);
    const collegeRequest = listingPayload({ ...emptyListing(), kind: 'request', title: 'Wanted: kettle', description: 'For my floor', audience: 'college' });
    const [{ id: collegeRequestId }] = await query(saveNew, [JSON.stringify(collegeRequest)]);
    await as(other);
    await assert.rejects(query(sendReply, [collegeRequestId, ...response]), /request_unavailable/);
    await as(recipient);
    await query(sendReply, [collegeRequestId, ...response]);
    await as(owner);
    await query('select public.save_listing($1, $2::jsonb)', [collegeRequestId, JSON.stringify({ ...collegeRequest, audience: 'campus' })]);
    assert.equal((await query('select college from public.listings where id = $1', [collegeRequestId]))[0].college, null);
    await as(other);
    assert.equal(await canSee(collegeRequestId), true);
  } finally { await db.close(); }
});
