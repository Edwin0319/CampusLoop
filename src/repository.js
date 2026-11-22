import { createClient } from '@supabase/supabase-js';
import { activeStatuses, allowedActions, campusDate, possessionFor, sampleId, sampleListing, seedListings, testModes } from './model.js';

const storageKey = 'campus-loop-web-v1';
const guest = 'local-guest';

function demoRepository(scenario) {
  let data = { listings: structuredClone(seedListings), handovers: [], messages: [] };
  if (!scenario) {
    try { data = JSON.parse(localStorage.getItem(storageKey)) ?? data; } catch { /* Browser storage is optional. */ }
  }

  function persist() {
    if (!scenario) localStorage.setItem(storageKey, JSON.stringify(data));
  }

  function seedRecovery() {
    if (data.listings.some(row => row.id === sampleId)) return;
    data.listings.push(sampleListing(guest));
    data.handovers.unshift({
      id: 'sample-handover', listing_id: sampleId, item_title: 'Introduction to Algorithms', owner_id: guest,
      recipient_id: null, pickup_date: campusDate(), pickup_time: '18:00', place: 'library', status: 'cancelled',
      placed: scenario !== 'recovery', created_at: new Date().toISOString(),
    });
    data.messages.push({ id: 'sample-message', handover_id: 'sample-handover', sender_id: null,
      body: 'Demo Rui: I can no longer make the pickup.' });
    persist();
  }

  if (['recovery', 'retrieval'].includes(scenario)) seedRecovery();
  return {
    source: scenario ? 'scenario' : 'local', userId: guest,
    async read() { return structuredClone(data); },
    async seedRecovery() { seedRecovery(); },
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
    async propose() { throw new Error('cloud_required'); },
    async changeHandover(id, action) {
      const transfer = data.handovers.find(row => row.id === id);
      if (!allowedActions(transfer, guest).includes(action)) throw new Error('invalid_transition');
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
      if (item?.status !== 'closed' || latest?.status !== 'cancelled' || possession !== possessionFor(latest)) {
        throw new Error('confirm_possession');
      }
      item.status = 'available';
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
  const test = new URLSearchParams(location.search).get('test');
  if (testModes.includes(test)) return demoRepository(test);
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url && !key) return demoRepository(null);
  if (!url || !key) throw new Error('incomplete_config');
  const client = createClient(url, key);
  const { session } = unwrap(await client.auth.getSession());
  const user = session?.user ?? unwrap(await client.auth.signInAnonymously()).user;
  if (!user) throw new Error('not_authenticated');
  const call = async (name, args) => unwrap(await client.rpc(name, args));
  return {
    source: 'cloud', userId: user.id,
    async read() {
      const results = await Promise.all([
        client.from('listings').select('*').eq('status', 'available').eq('audience', 'campus').order('created_at', { ascending: false }).limit(150),
        client.from('listings').select('*').eq('owner_id', user.id).order('created_at', { ascending: false }),
        client.from('handovers').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }),
        client.from('messages').select('*').order('created_at').order('id'),
      ]);
      const [feed, mine, handovers, messages] = results.map(unwrap);
      const listings = [...new Map([...feed, ...mine].map(row => [row.id, row])).values()];
      return { listings, handovers, messages };
    },
    seedRecovery: () => call('seed_recovery'),
    saveListing: (id, payload) => call('save_listing', { listing_id: id, payload }),
    propose: (id, plan) => call('propose_handover', { listing_id: id, ...plan }),
    changeHandover: (id, action) => call('change_handover', { handover_id: id, action }),
    relist: (id, possession) => call('relist', { listing_id: id, possession }),
    sendMessage: async (id, body) => unwrap(await client.from('messages').insert({ handover_id: id, sender_id: user.id, body })),
  };
}
