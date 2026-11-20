"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type CSSProperties, type FormEvent } from "react";
import {
  dayNumber, eventColors, formatRange, isoDate, layoutLane, monthStarts, todayOffset,
  type EventColor, type MarketingEvent, type MarketingLane,
} from "@/lib/marketing/calendar";
import type { FieldErrors } from "@/lib/marketing/validate";
import { preparePhoto } from "@/lib/prepare-photo";
import { createClient } from "@/lib/supabase/client";
import { deleteEvent, deleteLane, discardUpload, moveLane, saveEvent, saveLane, type ActionResult } from "./actions";

// The communication calendar: months across, categories down, one block per event (as on the original
// "Global communication calendar"). Clicking a block opens it for editing; changes are saved right away
// and the board reloads from the server.

const bucket = "marketing-calendar-images";
const imageUrl = (path: string) => `/marketing/image?path=${encodeURIComponent(path)}`;
// Row heights (px) per kind of category.
const rowHeight = { band: 30, events: 52, images: 214 } as const;

type Dialog = { kind: "event"; event: MarketingEvent | null; laneId: string } | { kind: "lanes" } | null;

export function CalendarBoard({ year, today, years, lanes, events }: {
  year: number; today: string; years: number[]; lanes: MarketingLane[]; events: MarketingEvent[];
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const months = monthStarts(year);
  const now = todayOffset(year, new Date(`${today}T12:00:00Z`));
  const otherYears = [...new Set([...years, year - 1, year + 1])].sort((a, b) => a - b);
  const firstEventLane = lanes.find(lane => lane.kind === "events") ?? lanes[0];

  return (
    <div className="mk-page">
      <div className="mk-toolbar">
        <nav className="mk-years" aria-label="Anul calendarului">
          <Link href={`/marketing?year=${year - 1}`} aria-label={`Anul ${year - 1}`}>‹</Link>
          <strong>{year}</strong>
          <Link href={`/marketing?year=${year + 1}`} aria-label={`Anul ${year + 1}`}>›</Link>
          <select aria-label="Alege anul" value={year} onChange={event => { window.location.href = `/marketing?year=${event.target.value}`; }}>
            {otherYears.map(option => <option key={option} value={option}>{option}{years.includes(option) ? "" : " (gol)"}</option>)}
          </select>
        </nav>
        <div className="mk-actions">
          <button type="button" className="button button-primary" disabled={!firstEventLane}
            onClick={() => firstEventLane && setDialog({ kind: "event", event: null, laneId: firstEventLane.id })}>+ Eveniment</button>
          <button type="button" className="button button-outline" onClick={() => setDialog({ kind: "lanes" })}>Categorii</button>
          <button type="button" className="button button-outline" onClick={() => window.print()}>Printează / PDF</button>
        </div>
      </div>

      <div className="mk-board">
        <div className="mk-sheet">
          <div className="mk-title">CALENDAR COMUNICARE {year}</div>
          <div className="mk-row mk-months">
            <div className="mk-label" />
            <div className="mk-track">
              {months.map((month, index) => (
                <div key={month.name} className="mk-month" style={{ left: `${month.start * 100}%`, width: `${((months[index + 1]?.start ?? 1) - month.start) * 100}%` }}>{month.name}</div>
              ))}
              {now !== null && <div className="mk-today" style={{ left: `${now * 100}%` }}><span>Azi</span></div>}
            </div>
          </div>

          {lanes.length === 0 && <p className="mk-empty">Calendarul nu are încă nicio categorie. Apasă „Categorii” ca să adaugi primul rând (de exemplu „Main communication”).</p>}
          {lanes.map(lane => {
            const laneEvents = events.filter(event => event.lane_id === lane.id);
            const { items, rows } = layoutLane(laneEvents, year, lane.kind === "band" ? 10 : 30);
            const height = lane.kind === "band" ? rowHeight.band : lane.show_images ? rowHeight.images : rowHeight.events;
            return (
              <div key={lane.id} className={`mk-row mk-lane mk-lane-${lane.kind}`}>
                <div className="mk-label">
                  <strong>{lane.name}</strong>
                  {lane.subtitle && <small>{lane.subtitle}</small>}
                </div>
                <div className="mk-track" style={{ height: rows * height + (lane.kind === "band" ? 22 : 12) }}>
                  {months.slice(1).map(month => <div key={month.name} className="mk-gridline" style={{ left: `${month.start * 100}%` }} />)}
                  {now !== null && <div className="mk-today" style={{ left: `${now * 100}%` }} />}
                  {items.map(({ event, row, left, width }) => {
                    const color = eventColors[event.color] ?? eventColors.dark;
                    const style: CSSProperties = {
                      left: `${left * 100}%`, width: `${width * 100}%`,
                      top: row * height + (lane.kind === "band" ? 18 : 6), height: height - 6,
                      "--mk-bg": color.background, "--mk-fg": color.text,
                    } as CSSProperties;
                    const dates = formatRange(event.start_date, event.end_date, event.dates_tbc);
                    const tooltip = `${event.title} ${formatRange(event.start_date, event.end_date, false)}${event.dates_tbc ? " (TBC)" : ""}${event.notes ? `\n${event.notes}` : ""}`;
                    return (
                      <button key={event.id} type="button" className={`mk-event ${lane.show_images && lane.kind === "events" ? "mk-event-card" : ""}`} style={style} title={tooltip}
                        onClick={() => setDialog({ kind: "event", event, laneId: lane.id })}>
                        {lane.kind === "band" && event.stock_in && <em className="mk-stock-in">Stock-in: {event.stock_in}</em>}
                        <span className="mk-event-text">
                          <strong>{event.title}</strong>
                          {(event.show_dates || event.dates_tbc) && <span>{dates}</span>}
                        </span>
                        {lane.show_images && lane.kind === "events" && (
                          <span className="mk-event-image">
                            {event.image_path
                              ? <img src={imageUrl(event.image_path)} alt="" loading="lazy" />
                              : <span className="mk-placeholder" aria-label="Fără imagine"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 17-5-5-9 8" /></svg>Imagine campanie</span>}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {dialog?.kind === "event" && <EventDialog event={dialog.event} laneId={dialog.laneId} lanes={lanes} year={year} today={today} onClose={() => setDialog(null)} />}
      {dialog?.kind === "lanes" && <LanesDialog lanes={lanes} events={events} onClose={() => setDialog(null)} />}
    </div>
  );
}

function FieldError({ errors, name }: { errors: FieldErrors; name: string }) {
  return errors[name] ? <span className="hc-field-error">{errors[name]}</span> : null;
}

// Runs an action, then reloads the board's data from the server.
function useSave() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  return async (action: () => Promise<ActionResult>): Promise<ActionResult> => {
    let result: ActionResult;
    try { result = await action(); } catch { result = { ok: false, error: "Nu s-a putut salva. Verifică legătura la internet și încearcă din nou." }; }
    if (result.ok) startTransition(() => router.refresh());
    return result;
  };
}

// ---- Event window -----------------------------------------------------------------------------------------

type EventValues = {
  title: string; laneId: string; startDate: string; endDate: string; datesTbc: boolean; showDates: boolean;
  color: EventColor; stockIn: string; notes: string; imagePath: string;
};

function EventDialog({ event, laneId, lanes, year, today, onClose }: {
  event: MarketingEvent | null; laneId: string; lanes: MarketingLane[]; year: number; today: string; onClose: () => void;
}) {
  // A new event starts today if the board shows this year, otherwise on 1 January; it lasts a week.
  const firstDay = today.startsWith(`${year}-`) ? today : `${year}-01-01`;
  const start: EventValues = {
    title: event?.title ?? "", laneId: event?.lane_id ?? laneId,
    startDate: event?.start_date ?? firstDay, endDate: event?.end_date ?? isoDate((dayNumber(firstDay) as number) + 6),
    datesTbc: event?.dates_tbc ?? false, showDates: event?.show_dates ?? true, color: event?.color ?? "dark",
    stockIn: event?.stock_in ?? "", notes: event?.notes ?? "", imagePath: event?.image_path ?? "",
  };
  const [values, setValues] = useState(start);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploads = useRef<string[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const save = useSave();
  const lane = lanes.find(item => item.id === values.laneId);
  const dirty = (Object.keys(start) as (keyof EventValues)[]).some(key => values[key] !== start[key]);
  useEffect(() => { dialog.current?.showModal(); }, []);

  const set = <K extends keyof EventValues>(key: K, value: EventValues[K]) => setValues(current => ({ ...current, [key]: value }));
  const field = (key: "title" | "laneId" | "startDate" | "endDate" | "stockIn" | "notes") => ({
    value: values[key], "aria-invalid": errors[key] ? true : undefined,
    onChange: (change: { target: { value: string } }) => set(key, change.target.value),
  });

  function discard(except: string) {
    for (const path of uploads.current) if (path !== except) void discardUpload(path);
    uploads.current = [];
  }

  function close() {
    if (dirty && !window.confirm("Închizi fereastra fără să salvezi modificările?")) return;
    discard("");
    onClose();
  }

  async function pickImage(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setErrors(current => ({ ...current, imagePath: "Alege o imagine JPG, PNG sau WEBP." })); return; }
    if (file.size > 25 * 1024 * 1024) { setErrors(current => ({ ...current, imagePath: "Imaginea este prea mare (cel mult 25 MB)." })); return; }
    setUploading(true);
    try {
      const blob = await preparePhoto(file);
      const path = `events/${crypto.randomUUID()}.jpg`;
      const { error } = await createClient().storage.from(bucket).upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (error) throw error;
      uploads.current.push(path);
      set("imagePath", path);
      setErrors(current => { const next = { ...current }; delete next.imagePath; return next; });
    } catch {
      setErrors(current => ({ ...current, imagePath: "Imaginea nu a putut fi încărcată. Încearcă din nou." }));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function submit(submitEvent: FormEvent) {
    submitEvent.preventDefault();
    setBusy(true);
    const result = await save(() => saveEvent(event?.id ?? null, { ...values, imagePath: values.imagePath || null }));
    setBusy(false);
    if (!result.ok) { setErrors(result.errors ?? {}); setMessage(result.error); return; }
    discard(values.imagePath);
    onClose();
  }

  async function remove() {
    if (!event || !window.confirm(`Ștergi evenimentul „${event.title}”? Nu se poate anula.`)) return;
    setBusy(true);
    const result = await save(() => deleteEvent(event.id));
    setBusy(false);
    if (!result.ok) { setMessage(result.error); return; }
    discard("");
    onClose();
  }

  return (
    <dialog ref={dialog} className="hc-dialog mk-dialog" onCancel={cancel => { cancel.preventDefault(); close(); }} aria-labelledby="mk-dialog-title">
      <form onSubmit={submit} noValidate>
        <header><h2 id="mk-dialog-title">{event ? "Modifică evenimentul" : "Eveniment nou"}</h2>
          <button type="button" className="hc-icon" onClick={close} aria-label="Închide">×</button></header>
        <div className="mk-dialog-body">
          <label className="mk-wide">Numele evenimentului *<input {...field("title")} maxLength={80} autoFocus placeholder="ex. BLACK FRIDAY & 11.11" /><FieldError errors={errors} name="title" /></label>
          <label className="mk-wide">Categoria (rândul din calendar) *<select {...field("laneId")}>{lanes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><FieldError errors={errors} name="laneId" /></label>
          <label>De la *<input type="date" {...field("startDate")} /><FieldError errors={errors} name="startDate" /></label>
          <label>Până la *<input type="date" {...field("endDate")} /><FieldError errors={errors} name="endDate" /></label>
          <label className="hc-check mk-wide"><input type="checkbox" checked={values.showDates} onChange={change => set("showDates", change.target.checked)} />Scrie datele pe calendar, de exemplu „(15 IAN – 30 MAR)”</label>
          <label className="hc-check mk-wide"><input type="checkbox" checked={values.datesTbc} onChange={change => set("datesTbc", change.target.checked)} />Date neconfirmate: pe calendar apare „(TBC)”</label>
          <fieldset className="mk-wide mk-colors">
            <legend>Culoare</legend>
            {(Object.keys(eventColors) as EventColor[]).map(color => (
              <label key={color} className={values.color === color ? "is-selected" : ""}>
                <input type="radio" name="color" value={color} checked={values.color === color} onChange={() => set("color", color)} />
                <span className="mk-swatch" style={{ background: eventColors[color].background }} />{eventColors[color].label}
              </label>
            ))}
            <FieldError errors={errors} name="color" />
          </fieldset>
          {lane?.kind === "band" && <label className="mk-wide">Stock-in (apare deasupra blocului)<input {...field("stockIn")} maxLength={60} placeholder="ex. End of Nov'26" /><FieldError errors={errors} name="stockIn" /></label>}
          {lane?.show_images && lane.kind === "events" && (
            <div className="mk-wide mk-image-field">
              <span className="mk-image-preview">{values.imagePath ? <img src={imageUrl(values.imagePath)} alt="Imaginea campaniei" /> : <span>Fără imagine (pe calendar apare un loc gol)</span>}</span>
              <div>
                <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={change => pickImage(change.target.files?.[0])} />
                <button type="button" className={`button button-outline ${uploading ? "is-busy" : ""}`} disabled={uploading} onClick={() => fileInput.current?.click()}>
                  {uploading && <span className="busy-spinner" aria-hidden="true" />}{values.imagePath ? "Înlocuiește imaginea" : "Încarcă imaginea"}</button>
                {values.imagePath && <button type="button" className="button danger-outline" disabled={uploading} onClick={() => set("imagePath", "")}>Elimină imaginea</button>}
                <FieldError errors={errors} name="imagePath" />
              </div>
            </div>
          )}
          <label className="mk-wide">Note (apar când ții mouse-ul pe eveniment)<textarea {...field("notes")} rows={3} maxLength={600} /><FieldError errors={errors} name="notes" /></label>
        </div>
        <footer>
          {message && <span className="hc-field-error">{message}</span>}
          {event && <button type="button" className="button danger-outline mk-delete" disabled={busy} onClick={remove}>Șterge</button>}
          <button type="button" className="button button-outline" onClick={close}>Renunță</button>
          <button type="submit" className={`button button-primary ${busy ? "is-busy" : ""}`} disabled={busy || uploading}>{busy && <span className="busy-spinner" aria-hidden="true" />}Salvează</button>
        </footer>
      </form>
    </dialog>
  );
}

// ---- Categories window ------------------------------------------------------------------------------------

function LanesDialog({ lanes, events, onClose }: { lanes: MarketingLane[]; events: MarketingEvent[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return (
    <dialog ref={dialog} className="hc-dialog mk-dialog" onCancel={cancel => { cancel.preventDefault(); onClose(); }} aria-labelledby="mk-lanes-title">
      <div className="mk-lanes">
        <header><h2 id="mk-lanes-title">Categorii (rândurile calendarului)</h2>
          <button type="button" className="hc-icon" onClick={onClose} aria-label="Închide">×</button></header>
        <div className="mk-lanes-body">
          {lanes.map((lane, index) => (
            <LaneRow key={lane.id} lane={lane} first={index === 0} last={index === lanes.length - 1}
              count={events.filter(event => event.lane_id === lane.id).length} />
          ))}
          <LaneRow lane={null} first last count={0} />
        </div>
        <footer><button type="button" className="button button-primary" onClick={onClose}>Gata</button></footer>
      </div>
    </dialog>
  );
}

function LaneRow({ lane, first, last, count }: { lane: MarketingLane | null; first: boolean; last: boolean; count: number }) {
  const start = { name: lane?.name ?? "", subtitle: lane?.subtitle ?? "", kind: lane?.kind ?? "events", showImages: lane?.show_images ?? false };
  const [values, setValues] = useState(start);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const save = useSave();
  const dirty = values.name !== start.name || values.subtitle !== start.subtitle || values.kind !== start.kind || values.showImages !== start.showImages;

  async function run(action: () => Promise<ActionResult>, after?: () => void) {
    setBusy(true);
    const result = await save(action);
    setBusy(false);
    if (!result.ok) { setErrors(result.errors ?? {}); setMessage(result.error); return; }
    setErrors({}); setMessage("");
    after?.();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(() => saveLane(lane?.id ?? null, values), lane ? undefined : () => setValues(start));
  }

  function remove() {
    if (!lane) return;
    if (!window.confirm(`Ștergi categoria „${lane.name}” și toate evenimentele ei, din toți anii (${count} în anul afișat)? Nu se poate anula.`)) return;
    void run(() => deleteLane(lane.id));
  }

  return (
    <form className={`mk-lane-row ${lane ? "" : "is-new"}`} onSubmit={submit} noValidate>
      {lane
        ? <div className="mk-order">
            <button type="button" className="hc-icon" disabled={first || busy} onClick={() => run(() => moveLane(lane.id, -1))} aria-label={`Mută ${lane.name} mai sus`}>↑</button>
            <button type="button" className="hc-icon" disabled={last || busy} onClick={() => run(() => moveLane(lane.id, 1))} aria-label={`Mută ${lane.name} mai jos`}>↓</button>
          </div>
        : <strong className="mk-new-label">Categorie nouă</strong>}
      <label>Nume *<input value={values.name} maxLength={60} onChange={event => setValues(current => ({ ...current, name: event.target.value }))} aria-invalid={errors.name ? true : undefined} placeholder="ex. MAIN COMMUNICATION" /><FieldError errors={errors} name="name" /></label>
      <label>Descriere (sub nume)<input value={values.subtitle} maxLength={160} onChange={event => setValues(current => ({ ...current, subtitle: event.target.value }))} placeholder="ex. (windows, ecom main banner, SM)" /><FieldError errors={errors} name="subtitle" /></label>
      <label>Tip<select value={values.kind} onChange={event => setValues(current => ({ ...current, kind: event.target.value as "band" | "events" }))}>
        <option value="events">Evenimente</option><option value="band">Bandă subțire (linii de produs, stock-in)</option></select></label>
      <label className="hc-check"><input type="checkbox" checked={values.showImages} disabled={values.kind === "band"} onChange={event => setValues(current => ({ ...current, showImages: event.target.checked }))} />Cu imagini</label>
      <div className="mk-lane-actions">
        {lane && <span className="hc-count">{count} {count === 1 ? "eveniment" : "evenimente"} în anul afișat</span>}
        <button type="submit" className={`button ${lane ? "button-outline" : "button-primary"} ${busy ? "is-busy" : ""}`} disabled={busy || !dirty}>{lane ? "Salvează" : "Adaugă"}</button>
        {lane && <button type="button" className="button danger-outline" disabled={busy} onClick={remove}>Șterge</button>}
      </div>
      {message && <span className="hc-field-error mk-lane-message">{message}</span>}
    </form>
  );
}
