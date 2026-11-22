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
import { createShareLink, deleteEvent, deleteLane, disableShareLink, discardUpload, moveLane, saveEvent, saveLane, type ActionResult } from "./actions";

// The communication calendar: months across, categories down, one block per event (as on the original
// "Global communication calendar"). Each category has its colour and its events take it. The sheet is
// read-only on the shared page; in the module, clicking a block opens it for editing and changes are saved
// right away (the board reloads from the server).

const bucket = "marketing-calendar-images";
const imageBase = "/marketing/image?path=";
const imageUrl = (path: string) => imageBase + encodeURIComponent(path);
// Row heights (px): plain categories and the one with campaign pictures.
const rowHeight = { events: 52, images: 214 } as const;

type Dialog = { kind: "event"; event: MarketingEvent | null; laneId: string } | { kind: "lanes" } | { kind: "share" } | null;

// The year switcher: previous / next year (links, so the address keeps the year). `base` ends in "year=".
export function YearNav({ year, base }: { year: number; base: string }) {
  return (
    <nav className="mk-years" aria-label="Calendar year">
      <Link href={`${base}${year - 1}`} aria-label={`Year ${year - 1}`}>‹</Link>
      <strong>{year}</strong>
      <Link href={`${base}${year + 1}`} aria-label={`Year ${year + 1}`}>›</Link>
    </nav>
  );
}

// The board itself. Without onOpen it is read-only (the shared page): blocks only show their details on hover.
// Pictures load from `imageBase` + the picture's path.
// Each category keeps at least `laneRows` sub-rows (its fullest year), so the board does not grow while filled in.
export function CalendarSheet({ year, today, lanes, events, laneRows, imageBase, onOpen }: {
  year: number; today: string; lanes: MarketingLane[]; events: MarketingEvent[]; laneRows: Record<string, number>;
  imageBase: string; onOpen?: (event: MarketingEvent, laneId: string) => void;
}) {
  const months = monthStarts(year);
  const now = todayOffset(year, new Date(`${today}T12:00:00Z`));
  return (
    <div className="mk-board">
      <div className="mk-sheet">
        <div className="mk-title">{year} GLOBAL COMMUNICATION CALENDAR</div>
        <div className="mk-row mk-months">
          <div className="mk-label" />
          <div className="mk-track">
            {months.map((month, index) => (
              <div key={month.name} className="mk-month" style={{ left: `${month.start * 100}%`, width: `${((months[index + 1]?.start ?? 1) - month.start) * 100}%` }}>{month.name}</div>
            ))}
            {now !== null && <div className="mk-today" style={{ left: `${now * 100}%` }}><span>Today</span></div>}
          </div>
        </div>

        {lanes.length === 0 && <p className="mk-empty">{onOpen ? "The calendar has no category yet. Press “Categories” to add the first row (for example “Main communication”)." : "The calendar is empty."}</p>}
        {lanes.map(lane => {
          const layout = layoutLane(events.filter(event => event.lane_id === lane.id), year, 30);
          const { items } = layout;
          const rows = Math.max(layout.rows, laneRows[lane.id] ?? 1);
          const height = lane.show_images ? rowHeight.images : rowHeight.events;
          const color = eventColors[lane.color] ?? eventColors.dark;
          return (
            <div key={lane.id} className="mk-row mk-lane">
              <div className="mk-label">
                <strong>{lane.name}</strong>
                {lane.subtitle && <small>{lane.subtitle}</small>}
              </div>
              <div className="mk-track" style={{ height: rows * height + 12 }}>
                {months.slice(1).map(month => <div key={month.name} className="mk-gridline" style={{ left: `${month.start * 100}%` }} />)}
                {now !== null && <div className="mk-today" style={{ left: `${now * 100}%` }} />}
                {items.map(({ event, row, left, width }) => {
                  const style: CSSProperties = {
                    left: `${left * 100}%`, width: `${width * 100}%`, top: row * height + 6, height: height - 6,
                    "--mk-bg": color.background, "--mk-fg": color.text,
                  } as CSSProperties;
                  const dates = formatRange(event.start_date, event.end_date, event.dates_tbc);
                  const tooltip = `${event.title} ${formatRange(event.start_date, event.end_date, false)}${event.dates_tbc ? " (TBC)" : ""}${event.notes ? `\n${event.notes}` : ""}`;
                  const content = <>
                    <span className="mk-event-text">
                      <strong>{event.title}</strong>
                      {(event.show_dates || event.dates_tbc) && <span>{dates}</span>}
                    </span>
                    {lane.show_images && (
                      <span className="mk-event-image">
                        {event.image_path
                          ? <img src={imageBase + encodeURIComponent(event.image_path)} alt="" loading="lazy" />
                          // Editors see where a picture is missing; the shared preview shows a plain box.
                          : onOpen ? <span className="mk-placeholder" aria-label="No picture"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 17-5-5-9 8" /></svg>Campaign picture</span>
                            : <span className="mk-placeholder is-blank" />}
                      </span>
                    )}
                  </>;
                  const className = `mk-event ${lane.show_images ? "mk-event-card" : ""} ${onOpen ? "" : "is-static"}`;
                  return onOpen
                    ? <button key={event.id} type="button" className={className} style={style} title={tooltip} onClick={() => onOpen(event, lane.id)}>{content}</button>
                    : <div key={event.id} className={className} style={style} title={tooltip}>{content}</div>;
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CalendarBoard({ year, today, lanes, events, laneRows, shareToken }: {
  year: number; today: string; lanes: MarketingLane[]; events: MarketingEvent[]; laneRows: Record<string, number>; shareToken: string | null;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const firstLane = lanes[0];

  return (
    <div className="mk-page">
      <div className="mk-toolbar">
        <YearNav year={year} base="/marketing?year=" />
        <div className="mk-actions">
          <button type="button" className="button button-primary" disabled={!firstLane}
            onClick={() => firstLane && setDialog({ kind: "event", event: null, laneId: firstLane.id })}>+ Event</button>
          <button type="button" className="button button-outline" onClick={() => setDialog({ kind: "lanes" })}>Categories</button>
          <button type="button" className="button button-outline" onClick={() => setDialog({ kind: "share" })}>Share</button>
          <button type="button" className="button button-outline" onClick={() => window.print()}>Print / PDF</button>
        </div>
      </div>

      <CalendarSheet year={year} today={today} lanes={lanes} events={events} laneRows={laneRows} imageBase={imageBase}
        onOpen={(event, laneId) => setDialog({ kind: "event", event, laneId })} />

      {dialog?.kind === "event" && <EventDialog event={dialog.event} laneId={dialog.laneId} lanes={lanes} year={year} today={today} onClose={() => setDialog(null)} />}
      {dialog?.kind === "lanes" && <LanesDialog lanes={lanes} events={events} onClose={() => setDialog(null)} />}
      {dialog?.kind === "share" && <ShareDialog token={shareToken} year={year} onClose={() => setDialog(null)} />}
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
    try { result = await action(); } catch { result = { ok: false, error: "Could not save. Check your internet connection and try again." }; }
    if (result.ok) startTransition(() => router.refresh());
    return result;
  };
}

// ---- Event window -----------------------------------------------------------------------------------------

type EventValues = {
  title: string; laneId: string; startDate: string; endDate: string; datesTbc: boolean; showDates: boolean;
  notes: string; imagePath: string;
};

function EventDialog({ event, laneId, lanes, year, today, onClose }: {
  event: MarketingEvent | null; laneId: string; lanes: MarketingLane[]; year: number; today: string; onClose: () => void;
}) {
  // A new event starts today if the board shows this year, otherwise on 1 January; it lasts a week.
  const firstDay = today.startsWith(`${year}-`) ? today : `${year}-01-01`;
  const start: EventValues = {
    title: event?.title ?? "", laneId: event?.lane_id ?? laneId,
    startDate: event?.start_date ?? firstDay, endDate: event?.end_date ?? isoDate((dayNumber(firstDay) as number) + 6),
    datesTbc: event?.dates_tbc ?? false, showDates: event?.show_dates ?? true,
    notes: event?.notes ?? "", imagePath: event?.image_path ?? "",
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
  const field = (key: "title" | "laneId" | "startDate" | "endDate" | "notes") => ({
    value: values[key], "aria-invalid": errors[key] ? true : undefined,
    onChange: (change: { target: { value: string } }) => set(key, change.target.value),
  });

  function discard(except: string) {
    for (const path of uploads.current) if (path !== except) void discardUpload(path);
    uploads.current = [];
  }

  function close() {
    if (dirty && !window.confirm("Close without saving your changes?")) return;
    discard("");
    onClose();
  }

  async function pickImage(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setErrors(current => ({ ...current, imagePath: "Choose a JPG, PNG or WEBP picture." })); return; }
    if (file.size > 25 * 1024 * 1024) { setErrors(current => ({ ...current, imagePath: "The picture is too large (25 MB at most)." })); return; }
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
      setErrors(current => ({ ...current, imagePath: "The picture could not be uploaded. Try again." }));
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
    if (!event || !window.confirm(`Delete the event “${event.title}”? This cannot be undone.`)) return;
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
        <header><h2 id="mk-dialog-title">{event ? "Edit event" : "New event"}</h2>
          <button type="button" className="hc-icon" onClick={close} aria-label="Close">×</button></header>
        <div className="mk-dialog-body">
          <label className="mk-wide">Event name *<input {...field("title")} maxLength={80} autoFocus placeholder="e.g. BLACK FRIDAY & 11.11" /><FieldError errors={errors} name="title" /></label>
          <label className="mk-wide">Category (row of the calendar) *<select {...field("laneId")}>{lanes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><FieldError errors={errors} name="laneId" /></label>
          <label>From *<input type="date" {...field("startDate")} /><FieldError errors={errors} name="startDate" /></label>
          <label>To *<input type="date" {...field("endDate")} /><FieldError errors={errors} name="endDate" /></label>
          <label className="hc-check mk-wide"><input type="checkbox" checked={values.showDates} onChange={change => set("showDates", change.target.checked)} />Print the dates on the calendar, e.g. “(15 JAN – 30 MAR)”</label>
          <label className="hc-check mk-wide"><input type="checkbox" checked={values.datesTbc} onChange={change => set("datesTbc", change.target.checked)} />Dates not confirmed: the calendar shows “(TBC)”</label>
          {lane && <p className="mk-wide mk-color-note"><span className="mk-swatch" style={{ background: (eventColors[lane.color] ?? eventColors.dark).background }} />Shown in the colour of {lane.name}.</p>}
          {lane?.show_images && (
            <div className="mk-wide mk-image-field">
              <span className="mk-image-preview">{values.imagePath ? <img src={imageUrl(values.imagePath)} alt="Campaign picture" /> : <span>No picture (the calendar shows an empty box)</span>}</span>
              <div>
                <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={change => pickImage(change.target.files?.[0])} />
                <button type="button" className={`button button-outline ${uploading ? "is-busy" : ""}`} disabled={uploading} onClick={() => fileInput.current?.click()}>
                  {uploading && <span className="busy-spinner" aria-hidden="true" />}{values.imagePath ? "Replace picture" : "Upload picture"}</button>
                {values.imagePath && <button type="button" className="button danger-outline" disabled={uploading} onClick={() => set("imagePath", "")}>Remove picture</button>}
                <FieldError errors={errors} name="imagePath" />
              </div>
            </div>
          )}
          <label className="mk-wide">Notes (shown when hovering the event)<textarea {...field("notes")} rows={3} maxLength={600} /><FieldError errors={errors} name="notes" /></label>
        </div>
        <footer>
          {message && <span className="hc-field-error">{message}</span>}
          {event && <button type="button" className="button danger-outline mk-delete" disabled={busy} onClick={remove}>Delete</button>}
          <button type="button" className="button button-outline" onClick={close}>Cancel</button>
          <button type="submit" className={`button button-primary ${busy ? "is-busy" : ""}`} disabled={busy || uploading}>{busy && <span className="busy-spinner" aria-hidden="true" />}Save</button>
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
        <header><h2 id="mk-lanes-title">Categories (rows of the calendar)</h2>
          <button type="button" className="hc-icon" onClick={onClose} aria-label="Close">×</button></header>
        <div className="mk-lanes-body">
          {lanes.map((lane, index) => (
            <LaneRow key={lane.id} lane={lane} first={index === 0} last={index === lanes.length - 1}
              count={events.filter(event => event.lane_id === lane.id).length} />
          ))}
          <LaneRow lane={null} first last count={0} />
        </div>
        <footer><button type="button" className="button button-primary" onClick={onClose}>Done</button></footer>
      </div>
    </dialog>
  );
}

function LaneRow({ lane, first, last, count }: { lane: MarketingLane | null; first: boolean; last: boolean; count: number }) {
  const start = { name: lane?.name ?? "", subtitle: lane?.subtitle ?? "", color: lane?.color ?? ("dark" as EventColor), showImages: lane?.show_images ?? false };
  const [values, setValues] = useState(start);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const save = useSave();
  const dirty = values.name !== start.name || values.subtitle !== start.subtitle || values.color !== start.color || values.showImages !== start.showImages;

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
    if (!window.confirm(`Delete the category “${lane.name}” and all its events, in every year (${count} in the year shown)? This cannot be undone.`)) return;
    void run(() => deleteLane(lane.id));
  }

  return (
    <form className={`mk-lane-row ${lane ? "" : "is-new"}`} onSubmit={submit} noValidate>
      {lane
        ? <div className="mk-order">
            <button type="button" className="hc-icon" disabled={first || busy} onClick={() => run(() => moveLane(lane.id, -1))} aria-label={`Move ${lane.name} up`}>↑</button>
            <button type="button" className="hc-icon" disabled={last || busy} onClick={() => run(() => moveLane(lane.id, 1))} aria-label={`Move ${lane.name} down`}>↓</button>
          </div>
        : <strong className="mk-new-label">New category</strong>}
      <label>Name *<input value={values.name} maxLength={60} onChange={event => setValues(current => ({ ...current, name: event.target.value }))} aria-invalid={errors.name ? true : undefined} placeholder="e.g. MAIN COMMUNICATION" /><FieldError errors={errors} name="name" /></label>
      <label>Description (under the name)<input value={values.subtitle} maxLength={160} onChange={event => setValues(current => ({ ...current, subtitle: event.target.value }))} placeholder="e.g. (windows, ecom main banner, SM)" /><FieldError errors={errors} name="subtitle" /></label>
      <label>Colour<span className="mk-color-select"><span className="mk-swatch" style={{ background: eventColors[values.color].background }} />
        <select value={values.color} onChange={event => setValues(current => ({ ...current, color: event.target.value as EventColor }))}>
          {(Object.keys(eventColors) as EventColor[]).map(color => <option key={color} value={color}>{eventColors[color].label}</option>)}</select></span></label>
      <label className="hc-check"><input type="checkbox" checked={values.showImages} onChange={event => setValues(current => ({ ...current, showImages: event.target.checked }))} />With pictures</label>
      <div className="mk-lane-actions">
        {lane && <span className="hc-count">{count} {count === 1 ? "event" : "events"} in the year shown</span>}
        <button type="submit" className={`button ${lane ? "button-outline" : "button-primary"} ${busy ? "is-busy" : ""}`} disabled={busy || !dirty}>{lane ? "Save" : "Add"}</button>
        {lane && <button type="button" className="button danger-outline" disabled={busy} onClick={remove}>Delete</button>}
      </div>
      {message && <span className="hc-field-error mk-lane-message">{message}</span>}
    </form>
  );
}

// ---- Share window -----------------------------------------------------------------------------------------

// One link for the whole calendar: whoever opens it sees the board (and can switch years), without an
// account and without changing anything. A new link replaces the old one; turning sharing off kills it.
function ShareDialog({ token: initial, year, onClose }: { token: string | null; year: number; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [token, setToken] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  useEffect(() => { dialog.current?.showModal(); }, []);
  const link = token ? `${window.location.origin}/share/calendar/${token}?year=${year}` : "";

  async function run(action: typeof createShareLink, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true); setMessage(""); setCopied(false);
    try {
      const result = await action();
      if (result.ok) { setToken(result.token); router.refresh(); } else setMessage(result.error);
    } catch { setMessage("Something went wrong. Try again."); }
    setBusy(false);
  }

  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setMessage("Copy the link by hand."); }
  }

  return (
    <dialog ref={dialog} className="hc-dialog mk-dialog" onCancel={cancel => { cancel.preventDefault(); onClose(); }} aria-labelledby="mk-share-title">
      <div className="mk-lanes">
        <header><h2 id="mk-share-title">Share the calendar</h2>
          <button type="button" className="hc-icon" onClick={onClose} aria-label="Close">×</button></header>
        <div className="mk-share-body">
          <p>Anyone with the link sees the calendar in preview mode: no account needed, nothing can be changed. They can switch years.</p>
          {token ? <>
            <div className="mk-share-link">
              <input readOnly value={link} aria-label="Share link" onFocus={event => event.target.select()} />
              <button type="button" className="button button-primary" onClick={copy}>{copied ? "Copied ✓" : "Copy link"}</button>
            </div>
            <div className="mk-share-actions">
              <a className="text-button" href={link} target="_blank" rel="noopener noreferrer">Open preview</a>
              <button type="button" className="text-button" disabled={busy} onClick={() => run(createShareLink, "Create a new link? The current link will stop working.")}>New link</button>
              <button type="button" className="text-button danger-text" disabled={busy} onClick={() => run(disableShareLink, "Turn sharing off? The link will stop working.")}>Turn off sharing</button>
            </div>
          </> : <div><button type="button" className={`button button-primary ${busy ? "is-busy" : ""}`} disabled={busy} onClick={() => run(createShareLink)}>
            {busy && <span className="busy-spinner" aria-hidden="true" />}Create link</button></div>}
          {message && <span className="hc-field-error">{message}</span>}
        </div>
        <footer><button type="button" className="button button-outline" onClick={onClose}>Done</button></footer>
      </div>
    </dialog>
  );
}
