import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LANGS, translator } from './locales.js';
import { activeStatuses, allowedActions, campusDate, categories, emptyListing, filterListings, handoverPlaceLabel, listingPayload, places, possessionFor } from './model.js';
import { connectRepository } from './repository.js';
import { Art, Button, DateLabel, Field, Heading, ListingCard, ListingDetails, ListingForm, Status } from './listings.jsx';
import './style.css';

const emptyData = { listings: [], handovers: [], messages: [], replies: [] };
const initialFilters = { kind: 'offer', category: '', mode: '', query: '' };
const actionText = { accept: 'actionAccept', place: 'actionPlace', receive: 'actionReceive', cancel: 'cancelHandover' };
const backendErrors = { incomplete_config: 'configMissing', listing_unavailable: 'notAvailableNow',
  past_date: 'futureTime', active_handover: 'activeHandover', listing_locked: 'activeHandover',
  custom_place_not_ready: 'customPlaceNotReady', request_unavailable: 'requestUnavailable',
  request_reply_not_ready: 'requestReplyNotReady' };

function App() {
  const [lang, setLanguage] = useState(() => {
    try { const saved = localStorage.getItem('campus-loop-language'); return LANGS[saved] ? saved : 'en'; } catch { return 'en'; }
  });
  const t = useMemo(() => translator(lang), [lang]);
  const locale = LANGS[lang].date ?? LANGS[lang].html;
  const [repository, setRepository] = useState(null);
  const [data, setData] = useState(emptyData);
  const [page, setPage] = useState({ name: 'discover' });
  const [filters, setFilters] = useState(initialFilters);
  const [form, setForm] = useState(null);
  const [plan, setPlan] = useState({ pickup_date: campusDate(), pickup_time: '', place: '', preset: '' });
  const [placeInvalid, setPlaceInvalid] = useState(false);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const main = useRef(null);
  const lock = useRef(false);

  function showError(exception, fallback = 'actionError') {
    setError(backendErrors[exception.message] ?? fallback);
  }

  async function connect() {
    setLoading(true);
    setError('');
    try {
      const service = await connectRepository();
      const snapshot = await service.read();
      setData(snapshot);
      setRepository(service);
      const practiceItem = snapshot.listings.find(row => row.id === service.startItemId);
      if (practiceItem) {
        const detail = { name: 'detail', id: practiceItem.id, previous: { name: 'discover' } };
        if (service.scenario === 'reply') go('reply', practiceItem.id, detail);
        else startPlan(practiceItem, detail);
      }
    } catch (exception) { showError(exception, 'loadError'); }
    finally { setLoading(false); }
  }

  useEffect(() => { connect(); }, []);
  useEffect(() => {
    document.documentElement.lang = LANGS[lang].html;
    try { localStorage.setItem('campus-loop-language', lang); } catch { /* Language still works in this session. */ }
  }, [lang]);
  useEffect(() => { main.current?.focus({ preventScroll: true }); }, [page]);

  function go(name, id, previous) {
    setPage({ name, id, previous });
    setCancelOpen(false);
    setError('');
    setNotice('');
    window.scrollTo(0, 0);
  }

  function goBack() {
    const previous = page.previous;
    go(previous?.name ?? 'discover', previous?.id, previous?.previous);
  }

  async function refresh() {
    if (lock.current || !repository) return;
    lock.current = true;
    setSaving(true);
    setError('');
    try { setData(await repository.read()); }
    catch (exception) { showError(exception, 'loadError'); }
    finally { lock.current = false; setSaving(false); }
  }

  async function change(write, next, messageKey) {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await write();
      next?.(result);
      if (messageKey) setNotice(messageKey);
      try { setData(await repository.read()); }
      catch (exception) { showError(exception, 'loadError'); }
    } catch (exception) { showError(exception); }
    finally { lock.current = false; setSaving(false); }
  }

  function resetRelistingDemo() {
    change(() => repository.resetRelisting(), handoverId => {
      if (page.name === 'reopened') go('handover', handoverId, { name: 'inbox' });
      else if (page.previous?.name === 'reopened') {
        setPage(current => ({ ...current, previous: { name: 'inbox' } }));
      }
    }, 'relistingDemoReset');
  }

  function startForm(item) {
    setForm({ ...emptyListing(), ...item, formMode: item?.pickup_slots?.length ? 'slots' : 'later' });
    go('post', undefined, item?.id ? page : undefined);
  }
  function startPlan(item, previous = page) {
    const suggested = item.pickup_slots.find(slot => slot.date >= campusDate());
    setPlan({ pickup_date: suggested?.date ?? campusDate(), pickup_time: suggested?.start ?? '', place: '', preset: '' });
    setPlaceInvalid(false);
    go('plan', item.id, previous);
  }

  function changePlace(place, preset = '') {
    setPlan(current => ({ ...current, place, preset }));
    setPlaceInvalid(false);
    if (error === 'customPlaceNotReady') setError('');
  }

  const userId = repository?.userId;
  const item = data.listings.find(row => row.id === page.id);
  const transfer = data.handovers.find(row => row.id === page.id);
  const reply = data.replies.find(row => row.id === page.id);
  const latest = item && data.handovers.find(row => row.listing_id === item.id);
  const owned = item?.owner_id === userId;
  const matching = filterListings(data.listings, filters, userId);
  const handoverPractice = repository?.scenario === 'handover';
  const relistingPractice = repository?.relistingPractice;
  const isRoot = ['discover', 'my', 'inbox'].includes(page.name);
  const activeTab = page.name === 'post' || page.name === 'review' ? 'post'
    : ['handover', 'replyDetails', 'reopen', 'reopened'].includes(page.name) ? 'inbox' : page.name;

  function renderPage() {
    if (!repository) return <div className="surface stack">{loading ? <p role="status">{t('refreshing')}</p>
      : <div className="button-row"><Button onClick={connect}>{t('retry')}</Button>
        <a className="button secondary button-link" href="?test=handover">{t('tryDemoHandover')}</a></div>}</div>;
    switch (page.name) {
      case 'discover': return <>
        <section className="hero"><p>{t('campus')}</p><h1>{t('heroTitle')}</h1><p>{t('appIntro')}</p></section>
        <section className="surface stack" aria-label={t('discover')}>
          <div className="switcher" role="group" aria-label={t('listingKind')}>
            {[['offer', 'offers'], ['request', 'requests']].map(([kind, label]) => <button key={kind} type="button" aria-pressed={filters.kind === kind}
              onClick={() => setFilters(old => ({ ...old, kind }))}>{t(label)}</button>)}
          </div>
          <Field label={t('searchLabel')}><input type="search" placeholder={t('search')} value={filters.query}
            onChange={event => setFilters(old => ({ ...old, query: event.target.value }))} /></Field>
          <div className="form-columns">
            <Field label={t('category')}><select value={filters.category} onChange={event => setFilters(old => ({ ...old, category: event.target.value }))}>
              <option value="">{t('all')}</option>{categories.map(category => <option key={category} value={category}>{t(category)}</option>)}
            </select></Field>
            <Field label={t('transferType')}><select value={filters.mode} onChange={event => setFilters(old => ({ ...old, mode: event.target.value }))}>
              <option value="">{t('any')}</option><option value="free">{t('free')}</option>
              <option value="sell">{t(filters.kind === 'offer' ? 'forSale' : 'paidRequest')}</option>
            </select></Field>
          </div>
          {(filters.category || filters.mode) && <Button kind="quiet" onClick={() => setFilters(old => ({ ...old, category: '', mode: '' }))}>{t('clearFilters')}</Button>}
        </section>
        <div className="section-row"><h2>{t(filters.kind === 'offer' ? 'results' : 'matchingRequests')}</h2><output aria-live="polite">{matching.length}</output></div>
        {matching.length ? <div className="results">{matching.map(row => <ListingCard key={row.id} item={row} t={t} onOpen={() => go('detail', row.id, page)} />)}</div>
          : <div className="surface stack"><h2>{t(filters.kind === 'offer' ? 'emptyTitle' : 'requestNoMatch')}</h2><p>{t('emptyText')}</p>
            <Button kind="secondary" onClick={() => setFilters(old => ({ ...initialFilters, kind: old.kind }))}>{t('browseAll')}</Button></div>}
      </>;
      case 'my': {
        const myListings = data.listings.filter(row => row.owner_id === userId);
        return <><Heading>{t('listingMine')}</Heading><div className="button-row">
          <Button kind="secondary" disabled={saving} onClick={refresh}>{t('refresh')}</Button>
        </div>{myListings.length ? <div className="results">{myListings.map(row => <ListingCard key={row.id} item={row} t={t} owner onOpen={() => go('detail', row.id, page)} />)}</div>
          : <div className="surface"><p>{t('noListings')}</p></div>}</>;
      }
      case 'detail':
        if (!item) return <div className="surface">{t('notAvailableNow')}</div>;
        return <><Heading note={owned ? t('selfDisplay') : item.display_name}>{item.title}</Heading><div className="surface stack">
          <Art item={item} hero /><div className="badges"><Status value={item.status} t={t} />{item.simulated && <span className="badge sample">{t('simulatedData')}</span>}</div>
          <ListingDetails item={item} t={t} locale={locale} />
        </div><div className="button-row">
          {owned && item.status === 'available' && !activeStatuses.includes(latest?.status) && !item.simulated && <Button onClick={() => startForm(item)}>{t('editListing')}</Button>}
          {latest && <Button kind="secondary" onClick={() => go('handover', latest.id, page)}>{t(latest.status === 'cancelled'
            ? (item.status === 'closed' ? 'viewCancelledHandover' : 'previousHandover') : 'viewPlan')}</Button>}
          {!owned && item.kind === 'request' && (item.simulated && repository.source === 'cloud'
            ? <a className="button button-link" href={`?test=reply&item=${encodeURIComponent(item.id)}`}>{t('offerToRequest')}</a>
            : <Button onClick={() => go('reply', item.id, page)}>{t('offerToRequest')}</Button>)}
          {!owned && !item.simulated && item.kind === 'offer' && !latest && repository.source === 'cloud' && <Button onClick={() => startPlan(item)}>{t('planHandover')}</Button>}
          {!owned && item.simulated && item.kind === 'offer' && !latest && item.status === 'available' && (handoverPractice
            ? <Button onClick={() => startPlan(item)}>{t('tryDemoHandover')}</Button>
            : <a className="button button-link" href={`?test=handover&item=${encodeURIComponent(item.id)}`}>{t('tryDemoHandover')}</a>)}
        </div></>;
      case 'post': return <ListingForm form={form} setForm={setForm} t={t} onReview={draft => { setForm(draft); go('review', undefined, page); }} />;
      case 'reply': {
        if (!item || owned || item.kind !== 'request' || item.status !== 'available') return <div className="surface">{t('requestUnavailable')}</div>;
        return <><Heading note={`${item.title} · ${item.display_name}`}>{t('replyToRequest')}</Heading>
          <form className="surface stack" key={item.id} onSubmit={event => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            const item_title = String(values.get('itemTitle')).trim();
            const description = String(values.get('description')).trim();
            if (!item_title || !description) {
              setError('replyFieldsRequired');
              event.currentTarget.elements[!item_title ? 'itemTitle' : 'description'].focus();
              return;
            }
            const price = item.mode === 'sell' ? Number(values.get('price')) : null;
            change(() => repository.sendReply(item.id, { item_title, description, price }),
              id => go('replyDetails', id, { name: 'inbox' }), repository.source === 'cloud' ? 'replySent' : 'demoReplySaved');
          }}>
            <p className="muted">{t(repository.source === 'cloud' ? 'replyVisibility' : 'demoReplyVisibility')}</p>
            <Field label={t('itemName')}><input name="itemTitle" required maxLength={100} /></Field>
            <Field label={t('description')}><textarea name="description" required maxLength={1500} /></Field>
            {item.mode === 'sell' && <Field label={t('price')}><input name="price" type="number" min="0.01" max="999999.99" step="0.01" inputMode="decimal" required /></Field>}
            <Button type="submit" disabled={saving}>{t('sendPrivateOffer')}</Button>
          </form></>;
      }
      case 'replyDetails':
        if (!reply) return <div className="surface">{t(saving ? 'refreshing' : 'requestUnavailable')}</div>;
        return <><Heading note={reply.request_title}>{reply.item_title}</Heading><div className="surface stack">
          <span className="badge">{t(reply.sender_id === userId ? 'offerSent' : 'offerReceived')}</span>
          <dl className="facts"><div><dt>{t('requests')}</dt><dd>{reply.request_title}</dd></div>
            <div><dt>{t('requestedBy')}</dt><dd>{reply.requester_name}</dd></div>
            <div><dt>{t('description')}</dt><dd>{reply.description}</dd></div>
            <div><dt>{t('transferType')}</dt><dd>{reply.mode === 'free' ? t('free') : t('namedPrice', { price: reply.price })}</dd></div>
          </dl>
        </div><Button kind="secondary" onClick={() => go('inbox')}>{t('openRequestReplies')}</Button></>;
      case 'review': {
        const payload = listingPayload(form);
        return <><Heading>{t('reviewTitleWeb')}</Heading><div className="surface stack"><h2>{payload.title}</h2>
          <ListingDetails item={payload} t={t} locale={locale} />
        </div><div className="button-row"><Button disabled={saving} onClick={() => change(() => repository.saveListing(form.id ?? null, payload),
          id => go('detail', id, { name: 'my' }), 'publishedMessage')}>{t(form.id ? 'editSaved' : 'publish')}</Button>
          <Button kind="secondary" disabled={saving} onClick={() => go('post', undefined, page.previous?.previous)}>{t('editDetails')}</Button></div></>;
      }
      case 'plan': return <><Heading note={item?.title}>{t('planHandover')}</Heading>
        {handoverPractice && <p className="muted">{t('handoverPracticeNote')}</p>}
        <form className="surface stack" onSubmit={event => {
        event.preventDefault();
        const { pickup_date, pickup_time, preset } = plan;
        const place = preset || plan.place.trim();
        if (!place || place.length > 100 || /[\u0000-\u001F\u007F-\u009F]/.test(place)) {
          setPlaceInvalid(true);
          event.currentTarget.elements.place.focus();
          return;
        }
        if (new Date(`${pickup_date}T${pickup_time}:00+08:00`) <= new Date()) { setError('futureTime'); return; }
        change(() => repository.propose(page.id, { pickup_date, pickup_time, place }), id => go('handover', id, { name: 'inbox' }),
          handoverPractice ? 'demoAccepted' : 'proposedSaved');
      }}><div className="form-columns">
        <Field label={t('date')}><input type="date" min={campusDate()} required value={plan.pickup_date} onChange={event => setPlan({ ...plan, pickup_date: event.target.value })} /></Field>
        <Field label={t('time')}><input type="time" required value={plan.pickup_time} onChange={event => setPlan({ ...plan, pickup_time: event.target.value })} /></Field>
      </div><div className="place-field">
        <Field label={t('location')}>
          <input name="place" value={plan.preset ? t(plan.preset) : plan.place} placeholder={t('placeExample')}
            maxLength={100} aria-required="true" aria-invalid={placeInvalid || undefined}
            aria-describedby={placeInvalid ? 'place-error' : undefined} onChange={event => changePlace(event.target.value)} />
        </Field>
        {placeInvalid && <p className="field-error" role="alert" id="place-error">{t('placeRequired')}</p>}
        <div className="place-suggestions" role="group" aria-label={t('suggestedPlaces')}>
          {places.map(place => <button type="button" key={place} aria-pressed={plan.preset === place} onClick={() => changePlace('', place)}>{t(place)}</button>)}
        </div>
      </div><Button type="submit" disabled={saving || !item}>{t('propose')}</Button></form></>;
      case 'inbox': return <><Heading>{t('handover')}</Heading><div className="button-row">
        {!['recovery', 'retrieval'].includes(repository.scenario) && <a className="button secondary button-link" href="?test=retrieval&amp;start=handover">{t('loadRecovery')}</a>}
        <Button kind="secondary" disabled={saving} onClick={refresh}>{t('refresh')}</Button>
      </div>
        <div className="surface stack">{data.handovers.length ? data.handovers.map(row => <button className="conversation" type="button" key={row.id} onClick={() => go('handover', row.id, page)}>
          <strong>{row.item_title}</strong><Status value={row.status} t={t} />
        </button>) : <p>{t('noMessages')}</p>}</div>
        <section className="surface stack"><h2>{t('openRequestReplies')}</h2>{data.replies.length ? data.replies.map(row =>
          <button className="conversation" type="button" key={row.id} onClick={() => go('replyDetails', row.id, page)}>
            <span><strong>{row.item_title}</strong> · {row.request_title}</span><span className="badge">{t(row.sender_id === userId ? 'offerSent' : 'offerReceived')}</span>
          </button>) : <p>{t('noRequestReplies')}</p>}</section></>;
      case 'handover': {
        if (!transfer) return <div className="surface">{t('notAvailableNow')}</div>;
        const messages = data.messages.filter(row => row.handover_id === transfer.id);
        const actions = allowedActions(transfer, userId);
        if (handoverPractice && transfer.status === 'confirmed') actions.unshift('place');
        const isActive = activeStatuses.includes(transfer.status);
        const latestForItem = data.handovers.find(row => row.listing_id === transfer.listing_id);
        const canRelist = transfer.status === 'cancelled' && transfer.owner_id === userId && latestForItem?.id === transfer.id
          && data.listings.some(row => row.id === transfer.listing_id && row.owner_id === userId && row.status === 'closed');
        return <><Heading note={t('viewingAs', { role: t(transfer.owner_id === userId ? 'owner' : 'recipient') })}>{transfer.item_title}</Heading>
          <div className="surface stack"><Status value={transfer.status} t={t} />
            <p><DateLabel value={transfer.pickup_date} locale={locale} /> · {transfer.pickup_time.slice(0, 5)} · {handoverPlaceLabel(transfer.place, t)}</p>
            <div className="button-row">{actions.map(action => <Button key={action} disabled={saving}
              kind={action === 'cancel' ? 'secondary' : 'primary'} onClick={() => {
                if (action === 'cancel') setCancelOpen(true);
                else change(() => repository.changeHandover(transfer.id, action), null, 'changeSaved');
              }}>{t(handoverPractice && action === 'place' ? 'simulateOwnerHandover' : actionText[action])}</Button>)}</div>
            {cancelOpen && <div className="notice stack"><p>{t('cancelAsk')}</p><div className="button-row">
              <Button kind="secondary" onClick={() => setCancelOpen(false)} disabled={saving}>{t('keepHandover')}</Button>
              <Button kind="danger" disabled={saving} onClick={() => change(() => repository.changeHandover(transfer.id, 'cancel'), () => setCancelOpen(false), 'changeSaved')}>{t('cancelHandover')}</Button>
            </div></div>}
            {canRelist && <div className="stack"><p className="muted">{t('closedText')}</p>
              <Button onClick={() => go('reopen', transfer.listing_id, page)}>{t('reviewReopen')}</Button></div>}
          </div>
          <div className="surface stack"><div className="section-row"><h2>{t(isActive ? 'messages' : 'archived')}</h2>
            <Button kind="quiet" disabled={saving} onClick={refresh}>{t('refresh')}</Button></div>
            {messages.length ? messages.map(row => <p className="bubble" key={row.id}><strong>{row.sender_id === userId ? t('you') : t('reply')}</strong>{row.body}</p>) : <p>{t('noChat')}</p>}
            {isActive && <form className="stack" onSubmit={event => {
              event.preventDefault(); if (message.trim()) change(() => repository.sendMessage(transfer.id, message.trim()), () => setMessage(''));
            }}><Field label={t('writeMessage')}><textarea maxLength={600} value={message} onChange={event => setMessage(event.target.value)} required /></Field>
              <Button type="submit" disabled={saving}>{t('send')}</Button></form>}
          </div></>;
      }
      case 'reopen': {
        if (!item || !owned || item.status !== 'closed' || latest?.status !== 'cancelled') return <div className="surface">{t('notAvailableNow')}</div>;
        return <><Heading note={item.title}>{t('reviewReopen')}</Heading><div className="notice stack">
          <strong>{t(latest.placed ? 'retrieveFirst' : 'confirmPossessionTitle')}</strong>
          <p>{t(latest.placed ? 'retrievalPrompt' : 'confirmPossessionBody', { place: handoverPlaceLabel(latest.place, t) })}</p>
        </div><div className="surface"><ListingDetails item={item} t={t} locale={locale} /></div>
          <div className="button-row"><Button kind="secondary" disabled={saving} onClick={goBack}>{t('keepClosed')}</Button>
            <Button disabled={saving} onClick={() => change(() => repository.relist(item.id, possessionFor(latest)),
              () => go('reopened', item.id, page.previous))}>{t(latest.placed ? 'confirmRetrieved' : 'confirmAndReopen')}</Button></div></>;
      }
      case 'reopened': return item && <><Heading note={item.title}>{t('reopenedTitle')}</Heading><div className="surface stack">
        <Status value={item.status} t={t} /><ListingDetails item={item} t={t} locale={locale} /></div>
        <div className="button-row">
          {latest && <Button onClick={() => go('handover', latest.id, page)}>{t('previousHandover')}</Button>}
          <Button kind="secondary" onClick={() => go('my')}>{t('listingMine')}</Button>
        </div></>;
      default: return null;
    }
  }

  const mode = repository && { local: 'localMode', scenario: 'scenarioMode', cloud: 'cloudMode' }[repository.source];
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-block"><span className="brand-mark" aria-hidden="true">↻</span><span className="brand">Campus Loop</span></div>
      <label className="language">
        <span className="language-globe" aria-hidden="true" />
        <span className="language-text">
          <span id="language-label" className="language-label">{t('language')}</span>
          <span className="language-current" aria-hidden="true">{LANGS[lang].name}</span>
        </span>
        <span className="language-chevron" aria-hidden="true" />
        <select aria-labelledby="language-label" value={lang} onChange={event => setLanguage(event.target.value)}>
          {Object.entries(LANGS).map(([code, entry]) => <option key={code} value={code} lang={entry.html}>{entry.name}</option>)}
        </select>
      </label>
    </header>
    <main className="workspace stack" ref={main} tabIndex={-1}>
      <div className="section-row top-line">
        {!isRoot && <Button kind="quiet back-button" aria-label={t('back')} disabled={saving} onClick={goBack}>
          <span aria-hidden="true">←</span>
        </Button>}
        {(handoverPractice || repository?.scenario === 'reply') && <a className="button quiet button-link" href="./">{t('exitPractice')}</a>}
        {relistingPractice ? <div className="button-row practice-tools">
          <p className="mode-label">{t('relistingPracticeMode')}</p>
          <Button kind="secondary" disabled={saving} onClick={resetRelistingDemo}>{t('resetRelistingDemo')}</Button>
        </div> : mode && <p className="mode-label">{t(mode)}</p>}
      </div>
      {error && <p className="notice error" role="alert">{t(error)}</p>}
      <div className="stack" aria-busy={saving}>{renderPage()}</div>
      <div role="status" className="muted">{notice && t(notice)}</div>
    </main>
    {repository && <nav className="bottom-nav" aria-label={t('discover')}>
      {[['discover', 'discover'], ['post', 'post'], ['inbox', 'handover'], ['my', 'listingMine']].map(([name, label]) => <button type="button" key={name}
        aria-current={activeTab === name ? 'page' : undefined} disabled={saving} onClick={() => name === 'post' ? startForm() : go(name)}>{t(label)}</button>)}
    </nav>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
