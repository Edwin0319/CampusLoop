export const categories = ['study', 'home', 'electronics'];
export const conditions = ['newCondition', 'good', 'fair', 'unknown'];
export const places = ['library', 'college', 'studentCentre'];
export const testModes = ['discovery', 'recovery', 'retrieval'];
export const activeStatuses = ['proposed', 'confirmed', 'awaiting'];
export const sampleId = 'e95eefad-1d61-478d-b80b-00f5683bfdc7';
export const emptySlot = () => ({ date: '', start: '', end: '' });
export const emptyListing = () => ({
  kind: 'offer', title: '', description: '', category: 'study', mode: 'free',
  condition: 'good', defects: '', price: '', audience: 'campus', pickup_slots: [], pickup_note: '', photo: '',
});

export const campusDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Macau', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export function validSlot(slot) {
  const date = new Date(`${slot.date}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(slot.date) && Number.isFinite(+date)
    && date.toISOString().slice(0, 10) === slot.date
    && /^([01]\d|2[0-3]):[0-5]\d$/.test(slot.start)
    && /^([01]\d|2[0-3]):[0-5]\d$/.test(slot.end) && slot.end > slot.start;
}

const normalize = text => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
export function filterListings(rows, { kind, category, mode, query }) {
  const terms = normalize(query).split(' ').filter(Boolean);
  return rows.filter(row => {
    if (row.kind !== kind || row.status !== 'available' || row.audience !== 'campus'
        || (category && row.category !== category) || (mode && row.mode !== mode)) return false;
    const haystack = normalize([row.title, row.description, row.display_name, row.search_terms].filter(Boolean).join(' '));
    return terms.every(term => haystack.includes(term));
  });
}

export function allowedActions(handover, userId) {
  if (!handover || ![handover.owner_id, handover.recipient_id].includes(userId)) return [];
  const isOwner = userId === handover.owner_id;
  if (handover.status === 'proposed') return isOwner ? ['accept', 'cancel'] : ['cancel'];
  if (handover.status === 'confirmed') return isOwner ? ['place', 'cancel'] : ['cancel'];
  if (handover.status === 'awaiting') return isOwner ? ['cancel'] : ['receive', 'cancel'];
  return [];
}

export const possessionFor = handover => handover?.placed ? 'retrieved' : 'has';

export function listingPayload(form) {
  const offer = form.kind === 'offer';
  return {
    kind: form.kind, title: form.title.trim(), description: form.description.trim(), category: form.category,
    mode: form.mode, condition: offer ? (form.condition || 'good') : null, defects: offer ? form.defects.trim() : '',
    price: offer && form.mode === 'sell' ? Number(form.price) : null, audience: form.audience,
    pickup_slots: offer ? form.pickup_slots : [], pickup_note: offer ? form.pickup_note.trim() : '',
    photo: offer ? form.photo : '',
  };
}

export const seedListings = [
  { id: '67e8e9a4-197b-41c8-ad16-033d21741a31', kind: 'offer', title: 'Adjustable USB desk lamp', description: 'Warm and neutral light. Pick up near the library.', category: 'study', mode: 'free', condition: 'good', defects: 'Small mark on the base.', display_name: 'Demo Alex', search_terms: '檯燈 台灯 書桌 candeeiro secretária', art: 'lamp' },
  { id: '844f6bf2-8505-4b24-870d-64ebd748617e', kind: 'offer', title: 'Calculus textbook', description: 'Second-year calculus. All pages intact.', category: 'study', mode: 'sell', condition: 'fair', defects: 'Pencil notes on two chapters.', price: 40, display_name: 'Demo Rui', search_terms: '微積分 微积分 課本 课本 livro cálculo', art: 'books' },
  { id: '20cba65c-9492-4516-9313-643a7d49039f', kind: 'offer', title: 'Stackable storage box', description: 'Clean 40 × 30 × 25 cm box.', category: 'home', mode: 'free', condition: 'good', defects: 'Light scuffs outside.', display_name: 'Demo Jo', search_terms: '收納箱 收纳箱 caixa arrumação', art: 'box' },
  { id: 'bd7290db-9ec8-4200-9ee8-a07c42e29f1b', kind: 'offer', title: 'USB keyboard', description: 'Wired keyboard with all keys working.', category: 'electronics', mode: 'sell', condition: 'good', defects: 'Minor wear on the space bar.', price: 30, display_name: 'Demo Ana', search_terms: '鍵盤 键盘 teclado', art: 'keyboard' },
  { id: '39194219-12b2-40e7-b840-9de1512be36f', kind: 'request', title: 'Free desk lamp for studying', description: 'Looking for a USB lamp for study. I can collect it on campus.', category: 'study', mode: 'free', display_name: 'Demo Rui', search_terms: '檯燈 台灯 書桌 candeeiro secretária', art: 'lamp' },
  { id: 'c1251e52-1a11-46f8-be05-b1bd305acd38', kind: 'request', title: 'Buying a study desk lamp', description: 'I can pay for a working desk lamp.', category: 'study', mode: 'sell', display_name: 'Demo Alex', search_terms: '檯燈 台灯 書桌 candeeiro secretária', art: 'lamp' },
  { id: 'b8188840-034f-401c-8bd2-25c012976880', kind: 'request', title: 'Free lamp for a bedside table', description: 'Any small lamp would suit my room.', category: 'home', mode: 'free', display_name: 'Demo Ana', search_terms: '檯燈 台灯 desk lamp candeeiro', art: 'lamp' },
].map(row => ({ ...emptyListing(), condition: null, defects: '', price: null, owner_id: null, status: 'available', simulated: true, ...row }));

export function sampleListing(owner, pickupDate = campusDate()) {
  return {
    ...emptyListing(), id: sampleId, owner_id: owner, display_name: 'Demo Mei', simulated: true, art: 'books',
    title: 'Introduction to Algorithms', description: 'A usable copy with all pages intact.', defects: 'Small fold on the cover.',
    status: 'closed', pickup_slots: [{ date: pickupDate, start: '18:00', end: '20:00' }],
  };
}
