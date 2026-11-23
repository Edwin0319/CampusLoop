import { useRef, useState } from 'react';
import { artSVG } from './art.js';
import { categories, categoriesFor, conditions, emptySlot, validSlot } from './model.js';

export function Button({ children, kind = 'primary', ...props }) {
  return <button type="button" className={`button ${kind}`} {...props}>{children}</button>;
}

export function Field({ label, children, error }) {
  return <label className="field"><span>{label}</span>{children}{error && <span className="field-error" role="alert">{error}</span>}</label>;
}

export function Heading({ children, note }) {
  return <header className="section-heading"><h1>{children}</h1>{note && <p>{note}</p>}</header>;
}

export function CategoryPicker({ label, selected, onChange, error, t }) {
  return <fieldset className="category-picker" aria-describedby={error ? 'category-error' : undefined}>
    <legend>{label}</legend>
    <div className="category-options">
      {categories.map(category => <label className="category-option" key={category}>
        <input type="checkbox" name="category" value={category} checked={selected.includes(category)} onChange={event =>
          onChange(event.target.checked ? [...selected, category] : selected.filter(value => value !== category))} />
        <span>{t(category)}</span>
      </label>)}
    </div>
    {error && <p className="field-error" role="alert" id="category-error">{error}</p>}
  </fieldset>;
}

export function DateLabel({ value, locale }) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
}

export function Art({ item, hero = false }) {
  return <div className={`art ${item.art} ${hero ? 'art-hero' : ''}`}>
    {item.photo ? <img src={item.photo} alt="" /> : <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: artSVG(item.art) }} />}
  </div>;
}

const modeLabel = item => item.mode === 'free' ? 'free' : item.kind === 'request' ? 'paidRequest' : 'forSale';
const offerLabel = item => item.kind === 'offer' ? 'offers' : 'requests';
const price = (item, t) => item.mode === 'sell' && item.kind === 'offer' ? t('namedPrice', { price: item.price }) : t(modeLabel(item));

export function Status({ value, t }) {
  return <span className={`badge ${value}`}>{t(value)}</span>;
}

export function ListingCard({ item, t, onOpen, owner = false }) {
  return <button type="button" onClick={onOpen} className="listing-card">
    <Art item={item} />
    <div className="item-copy">
      <h2>{item.title}</h2><p>{categoriesFor(item).map(category => t(category)).join(' · ')} · {owner ? t('selfDisplay') : item.display_name}</p>
      <div className="badges"><span className="badge">{price(item, t)}</span>
        {owner && <Status value={item.status} t={t} />}{item.simulated && <span className="badge sample">{t('simulatedData')}</span>}
      </div>
    </div>
  </button>;
}

export function ListingDetails({ item, t, locale }) {
  const isOffer = item.kind === 'offer';
  return <dl className="facts">
    <div><dt>{t('listingKind')}</dt><dd>{t(offerLabel(item))}</dd></div>
    <div><dt>{t('category')}</dt><dd>{categoriesFor(item).map(category => t(category)).join(' · ')}</dd></div>
    <div><dt>{t('transferType')}</dt><dd>{price(item, t)}</dd></div>
    <div><dt>{t('description')}</dt><dd>{item.description}</dd></div>
    {isOffer && <>
      <div><dt>{t('condition')}</dt><dd>{t(item.condition)}</dd></div>
      {item.defects && <div><dt>{t('defects')}</dt><dd>{item.defects}</dd></div>}
      <div><dt>{t('pickupAvailability')}</dt><dd>{item.pickup_slots.length ? <ul className="slot-summary">
        {item.pickup_slots.map((slot, index) => <li key={index}><DateLabel value={slot.date} locale={locale} /> · {slot.start}–{slot.end}</li>)}
      </ul> : t('pickupNone')}</dd></div>
      {item.pickup_note && <div><dt>{t('pickupNote')}</dt><dd>{item.pickup_note}</dd></div>}
    </>}
    <div><dt>{t('audience')}</dt><dd>{t(item.audience === 'private' ? 'privateAudience' : 'demoAudience')}</dd></div>
  </dl>;
}

export function ListingForm({ form, setForm, t, onReview }) {
  const [submitted, setSubmitted] = useState(false);
  const [photoError, setPhotoError] = useState(false);
  const [readingPhoto, setReadingPhoto] = useState(false);
  const dates = useRef(null);
  const offer = form.kind === 'offer';
  const selectedCategories = categoriesFor(form);
  const set = (name, value) => setForm(current => ({ ...current, [name]: value }));
  const setSlot = (index, field, value) => setForm(current => ({
    ...current, pickup_slots: current.pickup_slots.map((slot, position) => position === index ? { ...slot, [field]: value } : slot),
  }));

  async function loadPhoto(event) {
    const file = event.target.files[0];
    if (!file) return;
    setPhotoError(false);
    setReadingPhoto(true);
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 512 * 1024) throw new Error();
      const reader = new FileReader();
      const data = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      set('photo', data);
    } catch { setPhotoError(true); }
    finally { setReadingPhoto(false); }
  }

  function submit(event) {
    event.preventDefault();
    if (!form.title.trim() || !form.description.trim()) {
      setSubmitted(true);
      event.currentTarget.querySelector(!form.title.trim() ? '[name="title"]' : '[name="description"]').focus();
      return;
    }
    if (!selectedCategories.length) {
      setSubmitted(true);
      event.currentTarget.querySelector('[name="category"]').focus();
      return;
    }
    if (offer && form.formMode === 'slots' && form.pickup_slots.some(slot => !validSlot(slot))) {
      setSubmitted(true);
      dates.current.querySelectorAll('fieldset')[form.pickup_slots.findIndex(slot => !validSlot(slot))].querySelector('input').focus();
      return;
    }
    const pickup_slots = form.formMode === 'slots' ? form.pickup_slots : [];
    onReview({ ...form, pickup_slots });
  }

  return <form className="stack" onSubmit={submit}>
    <Heading>{t(form.id ? 'editListing' : 'post')}</Heading>
    <section className="surface stack">
      <fieldset className="listing-type">
        <legend>{t('listingKind')}</legend>
        <div className="listing-type-switch" data-kind={form.kind}>
          {[['offer', 'offerTitle'], ['request', 'requestItem']].map(([kind, label]) => (
            <label className="listing-type-option" key={kind}>
              <input type="radio" name="listing-kind" value={kind} checked={form.kind === kind}
                onChange={() => set('kind', kind)} />
              <span>
                <span className="listing-type-check" aria-hidden="true" />
                <span>{t(label)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label={t('listingTitle')} error={submitted && !form.title.trim() ? t('required') : null}>
        <input name="title" maxLength={100} value={form.title} onChange={event => set('title', event.target.value)} required />
      </Field>
      <Field label={t('description')} error={submitted && !form.description.trim() ? t('required') : null}>
        <textarea name="description" maxLength={1500} value={form.description} onChange={event => set('description', event.target.value)} required />
      </Field>
      <CategoryPicker label={t('categoryMultiple')} selected={selectedCategories} t={t} onChange={value => set('categories', value)}
        error={submitted && !selectedCategories.length ? t('categoryRequired') : null} />
      <Field label={t('transferType')}><select value={form.mode} onChange={event => set('mode', event.target.value)}>
        <option value="free">{t('free')}</option><option value="sell">{t(offer ? 'forSale' : 'paidRequest')}</option>
      </select></Field>
      {offer && <>
        <div className="form-columns">
          <Field label={t('condition')}><select value={form.condition || 'good'} onChange={event => set('condition', event.target.value)}>
            {conditions.map(condition => <option key={condition} value={condition}>{t(condition)}</option>)}
          </select></Field>
          <Field label={t('defects')}><input maxLength={300} value={form.defects} onChange={event => set('defects', event.target.value)} /></Field>
        </div>
        {form.mode === 'sell' && <Field label={t('price')}><input type="number" min="0.01" max="999999.99" step="0.01" inputMode="decimal" value={form.price ?? ''} onChange={event => set('price', event.target.value)} required /></Field>}
        <fieldset className="pickup stack">
          <legend>{t('pickupOptional')}</legend>
          <div className="form-columns">
            {[['later', 'pickupLater'], ['slots', 'pickupSet']].map(([mode, label]) => <label className="radio-tile" key={mode}>
              <input type="radio" name="pickup" value={mode} checked={form.formMode === mode} onChange={() => setForm(current => ({
                ...current, formMode: mode, pickup_slots: current.pickup_slots.length ? current.pickup_slots : [emptySlot()],
              }))} />{t(label)}
            </label>)}
          </div>
          {form.formMode === 'slots' && <div className="stack" ref={dates}>
            {form.pickup_slots.map((slot, index) => {
              const timeError = submitted && !validSlot(slot) && (slot.start && slot.end && slot.end <= slot.start ? t('pickupOrder') : t('badSlot'));
              return <fieldset className="time-slot stack" key={index}>
                <legend>{t('pickupSlot', { number: index + 1 })}</legend>
                <Field label={t('date')}><input type="date" value={slot.date} onChange={event => setSlot(index, 'date', event.target.value)} /></Field>
                <div className="form-columns">
                  <Field label={t('pickupStart')}><input type="time" value={slot.start} onChange={event => setSlot(index, 'start', event.target.value)} /></Field>
                  <Field label={t('pickupEnd')}><input type="time" value={slot.end} aria-invalid={!!timeError} aria-describedby={timeError ? `slot-error-${index}` : undefined} onChange={event => setSlot(index, 'end', event.target.value)} /></Field>
                </div>
                {timeError && <p id={`slot-error-${index}`} role="alert" className="field-error">{timeError}</p>}
                {form.pickup_slots.length > 1 && <Button kind="quiet" onClick={() => set('pickup_slots', form.pickup_slots.filter((_, position) => position !== index))}>{t('pickupRemove')}</Button>}
              </fieldset>;
            })}
            <Button kind="secondary" disabled={form.pickup_slots.length === 12} onClick={() => set('pickup_slots', [...form.pickup_slots, emptySlot()])}>{t('pickupAdd')}</Button>
            {form.pickup_slots.length === 12 && <small>{t('slotsLimit')}</small>}
          </div>}
          <details open={form.pickup_note ? true : undefined}>
            <summary>{t('pickupAddNote')}</summary>
            <Field label={t('pickupNote')}><input maxLength={300} value={form.pickup_note} onChange={event => set('pickup_note', event.target.value)} /></Field>
            <small>{t('pickupNoteHint')}</small>
          </details>
        </fieldset>
        <Field label={t('photo')} error={photoError ? t('imageNote') : null}>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={loadPhoto} />
        </Field>
        {!photoError && <small>{t('imageNote')}</small>}
        {form.photo && <Art item={form} />}
      </>}
      <Field label={t('audience')}><select value={form.audience} onChange={event => set('audience', event.target.value)}>
        <option value="campus">{t('demoAudience')}</option><option value="private">{t('privateAudience')}</option>
      </select></Field>
    </section>
    <Button type="submit" disabled={readingPhoto}>{t('reviewTitleWeb')}</Button>
  </form>;
}
