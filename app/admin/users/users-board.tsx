"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { minPasswordLength, roleLabels, usernamePattern, normalizeUsername } from "@/lib/accounts";
import type { UserRole } from "@/lib/auth";
import { changePassword, createUser, updateUser } from "./actions";

export type StaffUser = {
  id: string;
  full_name: string;
  username: string | null;
  notification_email: string | null;
  role: UserRole;
  active: boolean;
  created_at: string;
};

type Draft = { id: string | null; fullName: string; username: string; password: string; email: string; role: UserRole | ""; active: boolean };

const roles = Object.entries(roleLabels) as [UserRole, string][];
const emptyDraft: Draft = { id: null, fullName: "", username: "", password: "", email: "", role: "", active: true };

export function UsersBoard({ users, currentUserId, serviceReady }: { users: StaffUser[]; currentUserId: string; serviceReady: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const open = (next: Draft) => { setDraft(next); setNewPassword(""); setFeedback(null); };
  const close = () => { setDraft(null); setFeedback(null); };

  useEffect(() => {
    if (!draft) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft]);

  function run(action: () => Promise<{ ok: boolean; message: string }>, closeOnSuccess: boolean) {
    startTransition(async () => {
      const result = await action();
      setFeedback(result);
      if (result.ok) {
        router.refresh();
        if (closeOnSuccess) close(); else setNewPassword("");
      }
    });
  }

  const editing = draft?.id ? users.find((user) => user.id === draft.id) ?? null : null;
  const isSelf = draft?.id === currentUserId;
  const username = normalizeUsername(draft?.username ?? "");
  const canSave = !!draft && !!draft.fullName.trim() && !!draft.role
    && (draft.id ? true : usernamePattern.test(username) && draft.password.length >= minPasswordLength);

  return (
    <>
      <section className="board-panel" aria-label="Utilizatori">
        <div className="board-panel-heading">
          <div><h2>Utilizatori</h2><p>{users.filter((user) => user.active).length} conturi active din {users.length}.</p></div>
          <button type="button" className="button button-primary" onClick={() => open(emptyDraft)} disabled={!serviceReady}>+ Utilizator nou</button>
        </div>
        {!serviceReady && <p className="notice error users-notice" role="alert">Lipsește cheia SUPABASE_SERVICE_ROLE_KEY pe server. Poți vedea lista, dar nu poți crea conturi sau schimba parole.</p>}
        <div className="handed-table-wrap"><table className="handed-table">
          <thead><tr><th>Nume</th><th>Username</th><th>Rol</th><th>Email notificări</th><th>Status</th></tr></thead>
          <tbody>{users.map((user) => (
            <tr key={user.id} className={`handed-row ${draft?.id === user.id ? "selected" : ""}`}
              onClick={() => open({ id: user.id, fullName: user.full_name, username: user.username ?? "", password: "", email: user.notification_email ?? "", role: user.role, active: user.active })}>
              <td><button type="button" className="row-button strong" onClick={(event) => { event.stopPropagation(); open({ id: user.id, fullName: user.full_name, username: user.username ?? "", password: "", email: user.notification_email ?? "", role: user.role, active: user.active }); }}>{user.full_name}</button>{user.id === currentUserId && <small>Contul tău</small>}</td>
              <td className="nowrap">{user.username ?? <span className="muted-cell">cont vechi (email)</span>}</td>
              <td className="nowrap">{roleLabels[user.role]}</td>
              <td>{user.notification_email ?? <span className="muted-cell">—</span>}</td>
              <td className="nowrap"><span className={`outcome-chip ${user.active ? "ok" : "inactive"}`}>{user.active ? "Activ" : "Dezactivat"}</span></td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>

      {draft && <div className="detail-backdrop" onClick={close} aria-hidden="true" />}
      {draft && (
        <aside className="detail-panel" aria-label={draft.id ? "Editează utilizatorul" : "Utilizator nou"}>
          <div className="detail-header"><div><p className="eyebrow">{draft.id ? (editing?.username ?? "Cont vechi") : "Cont nou"}</p><h2>{draft.id ? "Editează utilizatorul" : "Utilizator nou"}</h2></div><button className="close-button" aria-label="Închide" onClick={close}>×</button></div>
          <div className="detail-scroll">
            <div className="form-stack">
              <label>Nume<input value={draft.fullName} maxLength={120} autoFocus onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} placeholder="ex. Ion Popescu" /></label>
              {!draft.id && <>
                <label>Username<input value={draft.username} maxLength={32} autoCapitalize="none" spellCheck={false} autoComplete="off"
                  onChange={(event) => setDraft({ ...draft, username: event.target.value })} placeholder="ex. ion.popescu" />
                  <small>3–32 caractere: litere mici, cifre, punct, cratimă sau underscore. Nu se mai poate schimba.</small></label>
                <label>Parolă<input type="text" value={draft.password} autoComplete="new-password" spellCheck={false}
                  onChange={(event) => setDraft({ ...draft, password: event.target.value })} placeholder={`Cel puțin ${minPasswordLength} caractere`} /></label>
              </>}
              <label>Email pentru notificări <span className="optional">opțional</span><input type="email" value={draft.email} maxLength={254}
                onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder="ex. depozit@atelierrebul.ro" />
                <small>Doar pentru notificări pe email. Același email poate fi folosit la mai mulți utilizatori.</small></label>
              <label>Rol<select value={draft.role} disabled={isSelf} onChange={(event) => setDraft({ ...draft, role: event.target.value as UserRole })}>
                <option value="" disabled>Alege rolul</option>
                {roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>
              {draft.id && !isSelf && <label className="admin-checkbox"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /> Cont activ (poate intra în aplicație)</label>}
            </div>

            {draft.id && <section className="detail-section"><h3>Schimbă parola</h3>
              <div className="scan-form">
                <input type="text" value={newPassword} autoComplete="new-password" spellCheck={false} onChange={(event) => setNewPassword(event.target.value)}
                  placeholder={`Parolă nouă, cel puțin ${minPasswordLength} caractere`} aria-label="Parolă nouă" />
                <button type="button" className="button button-outline" disabled={pending || !serviceReady || newPassword.length < minPasswordLength}
                  onClick={() => run(() => changePassword(draft.id!, newPassword), false)}>Schimbă</button>
              </div>
            </section>}
            {feedback && <p className={`action-feedback ${feedback.ok ? "success" : "error"}`} role="status" aria-live="polite">{feedback.message}</p>}
          </div>
          <div className="detail-actions">
            <button className="button button-primary" disabled={pending || !canSave}
              onClick={() => run(() => draft.id
                ? updateUser({ id: draft.id, fullName: draft.fullName, email: draft.email, role: draft.role, active: draft.active })
                : createUser({ fullName: draft.fullName, username: draft.username, password: draft.password, email: draft.email, role: draft.role }), true)}>
              {draft.id ? "Salvează modificările" : "Creează contul"}
            </button>
          </div>
        </aside>
      )}
    </>
  );
}
