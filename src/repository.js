import { createClient } from '@supabase/supabase-js';
import { activeStatuses, allowedActions, campusDate, possessionFor, sampleId, sampleListing, seedListings, testModes } from './model.js';

const storageKey = 'campus-loop-web-v1';
const guest = 'local-guest';
const demoOwner = 'demo-owner';

function createRelistingSample(owner, placed) {
  const listing = sampleListing(owner);
  const handover = {
    id: 'sample-handover', listing_id: listing.id, item_title: listing.title, owner_id: owner,
    recipient_id: null, pickup_date: campusDate(), pickup_time: '18:00', place: 'library', status: 'cancelled',
    placed, simulated: true, created_at: new Date().toISOString(),
  };
  const message = { id: 'sample-message', handover_id: handover.id, sender_id: null,
    body: 'Demo Rui: I can no longer make the pickup.' };
  return { listing, handover, message };
}

function reopenListing(listing, handover, possession) {
  if (listing?.status !== 'closed' || handover?.status !== 'cancelled' || possession !== possessionFor(handover)) {
    throw new Error('confirm_possession');
  }
  listing.status = 'available';
}

function withRelistingSample(repository) {
  const sample = createRelistingSample(repository.userId, true);
  return {
    ...repository,
    async read() {
      const data = await repository.read();
      const { listing, handover, message } = structuredClone(sample);
      return { ...data, listings: [...data.listings, listing], handovers: [handover, ...data.handovers],
        messages: [...data.messages, message] };
    },
    async relist(id, possession) {
      if (id === sampleId) reopenListing(sample.listing, sample.handover, possession);
      else await repository.relist(id, possession);
    },
    async resetRelisting() { sample.listing.status = 'closed'; },
  };
}

function demoRepository(scenario, startItemId, relistingPractice = false) {
  let data = { listings: structuredClone(seedListings), handovers: [], messages: [], replies: [] };
  if (!scenario) {
    try { data = { ...data, ...JSON.parse(localStorage.getItem(storageKey)) }; } catch { /* Browser storage is optional. */ }
  }

  function persist() {
    if (!scenario) localStorage.setItem(storageKey, JSON.stringify(data));
  }

  const recoverySample = ['recovery', 'retrieval'].includes(scenario)
    ? createRelistingSample(guest, scenario === 'retrieval') : null;
  if (recoverySample) {
    const { listing, handover, message } = recoverySample;
    data.listings.push(listing);
    data.handovers.unshift(handover);
    data.messages.push(message);
  }

  return {
    source: scenario ? 'scenario' : 'local', userId: guest, scenario, startItemId,
    ...(relistingPractice && {
      async resetRelisting() { recoverySample.listing.status = 'closed'; },
    }),
    async read() { return structuredClone(data); },
    async sendReply(id, offer) {
      const request = data.listings.find(row => row.id === id && row.kind === 'request' && row.status === 'available'
        && row.audience === 'campus' && row.owner_id !== guest);
      if (!request) throw new Error('request_unavailable');
      const replyId = crypto.randomUUID();
      data.replies.unshift({ id: replyId, request_id: id, request_title: request.title, requester_name: request.display_name,
        requester_id: request.owner_id, sender_id: guest, mode: request.mode, ...offer });
      persist();
      return replyId;
    },
    async saveListing(id, payload) {
      const item = id && data.listings.find(row => row.id === id && row.owner_id === guest);
      if (id && (!item || item.status !== 'available' || data.handovers.some(row => row.listing_id === id && activeStatuses.includes(row.status)))) {
        throw new Error('listing_locked');
      }
      const row = { id: id ?? crypto.randomUUID(), owner_id: guest, display_name: 'Campus member', status: 'available',
        art: payload.category === 'study' ? 'books' : payload.category === 'electronics' ? 'keyboard' : 'box', ...payload };
      if (item) Object.assign(item, row);
      else data.listings.unshift(row);
      persist();
      return row.id;
    },
    async propose(id, plan) {
      const item = data.listings.find(row => row.id === id);
      if (scenario !== 'handover' || !item?.simulated || item.kind !== 'offer' || item.status !== 'available') {
        throw new Error('listing_unavailable');
      }
      const transfer = {
        id: crypto.randomUUID(), listing_id: id, item_title: item.title, owner_id: demoOwner, recipient_id: guest,
        ...plan, status: 'confirmed', placed: false, created_at: new Date().toISOString(),
      };
      item.status = 'reserved';
      data.handovers.unshift(transfer);
      return transfer.id;
    },
    async changeHandover(id, action) {
      const transfer = data.handovers.find(row => row.id === id);
      const simulatesOwner = scenario === 'handover' && action === 'place' && transfer?.owner_id === demoOwner
        && transfer.recipient_id === guest && transfer.status === 'confirmed';
      if (!simulatesOwner && !allowedActions(transfer, guest).includes(action)) throw new Error('invalid_transition');
      const item = data.listings.find(row => row.id === transfer.listing_id);
      if (action === 'cancel' && transfer.status !== 'proposed') item.status = 'closed';
      if (action === 'accept') item.status = 'reserved';
      if (action === 'place') transfer.placed = true;
      if (action === 'receive') item.status = 'completed';
      transfer.status = { accept: 'confirmed', place: 'awaiting', receive: 'completed', cancel: 'cancelled' }[action];
      persist();
    },
    async relist(id, possession) {
      const item = data.listings.find(row => row.id === id && row.owner_id === guest);
      const latest = data.handovers.find(row => row.listing_id === id);
      reopenListing(item, latest, possession);
      persist();
    },
    async sendMessage(id, body) {
      const transfer = data.handovers.find(row => row.id === id);
      if (!transfer || !activeStatuses.includes(transfer.status)) throw new Error('invalid_transition');
      data.messages.push({ id: crypto.randomUUID(), handover_id: id, sender_id: guest, body });
      persist();
    },
  };
}

function unwrap(result) {
  if (result.error) throw new Error(result.error.code === '23505' ? 'active_handover' : result.error.message);
  return result.data;
}

export async function connectRepository() {
  const params = new URLSearchParams(location.search);
  const test = params.get('test');
  if (testModes.includes(test)) {
    const kind = { handover: 'offer', reply: 'request' }[test];
    const startItemId = seedListings.find(row => row.id === params.get('item') && row.kind === kind)?.id;
    const relistingPractice = test === 'retrieval' && ['handover', 'my'].includes(params.get('start'));
    return demoRepository(test, startItemId, relistingPractice);
  }
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url && !key) return withRelistingSample(demoRepository(null));
  if (!url || !key) throw new Error('incomplete_config');
  const client = createClient(url, key);
  const { session } = unwrap(await client.auth.getSession());
  const user = session?.user ?? unwrap(await client.auth.signInAnonymously()).user;
  if (!user) throw new Error('not_authenticated');
  const call = async (name, args) => unwrap(await client.rpc(name, args));
  return withRelistingSample({
    source: 'cloud', userId: user.id,
    async read() {
      const results = await Promise.all([
        client.from('listings').select('*').eq('status', 'available').eq('audience', 'campus').order('created_at', { ascending: false }).limit(150),
        client.from('listings').select('*').eq('owner_id', user.id).order('created_at', { ascending: false }),
        client.from('handovers').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }),
        client.from('messages').select('*').order('created_at').order('id'),
        client.from('request_replies').select('*').order('created_at', { ascending: false }),
      ]);
      const [feed, mine, handovers, messages] = results.slice(0, 4).map(unwrap);
      const replyResult = results[4];
      const replies = ['PGRST205', '42P01'].includes(replyResult.error?.code) ? [] : unwrap(replyResult);
      const listings = [...new Map([...feed, ...mine].map(row => [row.id, row])).values()];
      return { listings, handovers, messages, replies };
    },
    async sendReply(id, offer) {
      const result = await client.rpc('send_request_reply', { request_id: id, ...offer });
      if (result.error?.code === 'PGRST202' || result.error?.code === '42P01') throw new Error('request_reply_not_ready');
      return unwrap(result);
    },
    saveListing: (id, payload) => call('save_listing', { listing_id: id, payload }),
    async propose(id, plan) {
      const result = await client.rpc('propose_handover', { listing_id: id, ...plan });
      if (result.error?.code === '23514' && result.error.message.includes('"handovers_place_check"')) {
        throw new Error('custom_place_not_ready');
      }
      return unwrap(result);
    },
    changeHandover: (id, action) => call('change_handover', { handover_id: id, action }),
    relist: (id, possession) => call('relist', { listing_id: id, possession }),
    sendMessage: async (id, body) => unwrap(await client.from('messages').insert({ handover_id: id, sender_id: user.id, body })),
  });
}
