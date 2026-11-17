"use client";

import { useMemo, useState } from "react";
import { fmtD } from "@/lib/leave/dates";
import { balance, checkDraft, patternLabel } from "@/lib/leave/engine";
import { LEAVE_TYPES, UNITS, typeInfo, type AppState, type Draft, type LeaveType, type Unit } from "@/lib/leave/types";
import { submitLeave } from "@/server/leave-actions";

async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 400_000) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}

export function ApplyForm({ state, employeeId, defaults }: { state: AppState; employeeId: string; defaults: { start: string; end: string } }) {
  const me = state.employees.find((person) => person.id === employeeId);
  const [type, setType] = useState<LeaveType>("AL");
  const [unit, setUnit] = useState<Unit>("full");
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [hours, setHours] = useState("4");
  const [reason, setReason] = useState("");
  const [fileName, setFileName] = useState("");
  const [childDob, setChildDob] = useState("");
  const [childCitizen, setChildCitizen] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const draft: Draft = useMemo(
    () => ({
      employeeId,
      type,
      unit,
      start,
      end,
      hours: Number(hours),
      reason,
      hasFile: Boolean(fileName),
      fileName,
      childDateOfBirth: childDob || undefined,
      childCitizen,
    }),
    [employeeId, type, unit, start, end, hours, reason, fileName, childDob, childCitizen],
  );
  const check = checkDraft(state, draft);
  const year = /^\d{4}/.test(start) ? Number(start.slice(0, 4)) : Number(state.today.slice(0, 4));
  const bal = me ? balance(state, me, type, year) : null;
  const infos: string[] = [];
  if (!check.errors.length && me) {
    infos.push(
      `Counts as ${fmtD(check.days)} ${type === "ML" ? "calendar" : "working"} day(s) on a ${patternLabel(me.workPattern)} pattern${check.holidays.length ? `, excluding ${check.holidays.join(" and ")}` : ""}.`,
    );
    if (bal?.avail !== null && bal) infos.push(`Balance after this request: ${fmtD((bal.avail || 0) - check.days)} of ${fmtD(bal.ent.total || 0)} days.`);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (check.errors.length) return;
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const input = event.currentTarget.elements.namedItem("file");
    const picked = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (picked && picked.type.startsWith("image/")) {
      const smaller = await compressImage(picked);
      data.set("file", smaller);
    }
    const result = await submitLeave(data);
    if (result?.error) {
      setError(result.error);
      setPending(false);
    }
  }

  if (!me) return null;
  const parental = type === "ML" || type === "PL" || type === "SPL";
  return (
    <form onSubmit={onSubmit}>
      <div className="grid">
        <label className="field"><span>Leave type</span>
          <select name="type" value={type} onChange={(event) => setType(event.target.value as LeaveType)}>
            {LEAVE_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="field"><span>Duration</span>
          <select name="unit" value={unit} onChange={(event) => setUnit(event.target.value as Unit)}>
            {UNITS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="field"><span>{unit === "full" ? "From" : "Date"}</span>
          <input type="date" name="start" value={start} onChange={(event) => { setStart(event.target.value); if (end < event.target.value) setEnd(event.target.value); }} required />
        </label>
        {unit === "full" ? (
          <label className="field"><span>To</span>
            <input type="date" name="end" value={end} min={start} onChange={(event) => setEnd(event.target.value)} required />
          </label>
        ) : null}
        {unit === "hours" ? (
          <label className="field"><span>Hours</span>
            <select name="hours" value={hours} onChange={(event) => setHours(event.target.value)}>
              {["1", "2", "3", "4", "5", "6", "7"].map((hour) => <option key={hour}>{hour}</option>)}
            </select>
          </label>
        ) : null}
      </div>
      <div className="grid" style={{ marginTop: "0.8rem" }}>
        <label className="field"><span>Reason</span>
          <textarea name="reason" value={reason} placeholder="Short reason for your approver" onChange={(event) => setReason(event.target.value)} />
        </label>
        <label className="field"><span>{type === "SL" || type === "HL" ? "MC or hospital document (required)" : "Supporting document (optional)"}</span>
          <input name="file" type="file" accept="image/*,.pdf" capture="environment" onChange={(event) => setFileName(event.target.files?.[0]?.name || "")} />
          <small className="caption">{fileName ? `Attached: ${fileName}. Photos are reduced on this phone before upload.` : "JPG, PNG, WEBP or PDF, up to 5 MB."}</small>
        </label>
      </div>
      {parental ? (
        <div className="grid" style={{ marginTop: "0.8rem" }}>
          <label className="field"><span>Child&apos;s date of birth</span>
            <input type="date" name="childDob" value={childDob} onChange={(event) => setChildDob(event.target.value)} />
          </label>
          <label className="field"><span>Singapore citizen child</span>
            <select name="childCitizen" value={childCitizen ? "yes" : "no"} onChange={(event) => setChildCitizen(event.target.value === "yes")}>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
        </div>
      ) : null}
      <div aria-live="polite" style={{ marginTop: "0.8rem" }}>
        {check.errors.map((message) => <div className="msg" key={message}><span className="badge bad">Fix</span><span>{message}</span></div>)}
        {check.warnings.map((message) => <div className="msg" key={message}><span className="badge warn">Check</span><span>{message}</span></div>)}
        {infos.map((message) => <div className="msg" key={message}><span className="badge">Info</span><span>{message}</span></div>)}
        {bal ? <p className="caption">{typeInfo(type).label}: {bal.ent.note}</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
      <div className="row" style={{ marginTop: "0.8rem" }}>
        <button className="btn primary" type="submit" disabled={pending || check.errors.length > 0}>{pending ? "Sending…" : "Submit application"}</button>
      </div>
    </form>
  );
}
