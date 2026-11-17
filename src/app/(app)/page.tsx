import Link from "next/link";
import { ApplyForm } from "@/components/apply-form";
import { ActionForm } from "@/components/action-form";
import { RequestLine, StatusBadge, YearLinks, balanceRows } from "@/components/status";
import { balanceTable, empOf, patternLabel } from "@/lib/leave/engine";
import { CORE_TYPES, PARENTAL_TYPES } from "@/lib/leave/types";
import { amendLeave, cancelLeave } from "@/server/leave-actions";
import { currentEmployee, loadState } from "@/server/store";
import { prisma } from "@/lib/db";
import { nice } from "@/lib/leave/dates";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ year?: string; notice?: string }> }) {
  const query = await searchParams;
  const me = await currentEmployee();
  const state = await loadState();
  const person = empOf(state, me.id);
  if (!person) return null;
  const year = query.year === "2027" ? 2027 : 2026;
  const mine = state.requests.filter((request) => request.employeeId === me.id).sort((a, b) => (a.start < b.start ? 1 : -1));
  const docs = await prisma.document.findMany({ where: { requestId: { in: mine.map((request) => request.id) } } });
  const docFor = new Map(docs.map((doc) => [doc.requestId, doc.id]));
  const approver = person.approverId ? empOf(state, person.approverId)?.name : "HR admin";
  const defaults = state.today <= "2026-12-07" ? { start: "2026-12-07", end: "2026-12-09" } : { start: state.today, end: state.today };
  const personal = { ...state, employees: [person], requests: mine, credits: state.credits.filter((credit) => credit.employeeId === me.id), openingCarry: state.openingCarry.filter((row) => row.employeeId === me.id) };
  return (
    <>
      {query.notice ? <p className="flash">{query.notice}</p> : null}
      <section className="card">
        <h1>Balances for {person.name}</h1>
        <p className="caption">
          {person.category === "CREW" ? `Crew on ${person.group}, ${patternLabel(person.workPattern)} pattern. Crew are not covered by the Employment Act; this balance uses the crew contract policy.` : `Shore office, ${patternLabel(person.workPattern)} pattern.`}
          {" "}Joined {nice(person.joined)}. Approver: {approver}.
        </p>
        <YearLinks year={year} base="/" />
        {balanceRows(balanceTable(state, person, year, CORE_TYPES.map((type) => type.value)))}
        <h2 style={{ marginTop: "1rem" }}>Parental leave</h2>
        <p className="caption">Calculated from the child on record. Maternity, paternity and shared parental leave are all listed; HR confirms which scheme applies.</p>
        {balanceRows(balanceTable(state, person, year, PARENTAL_TYPES.map((type) => type.value)))}
      </section>
      <section className="card">
        <h2>Apply for leave</h2>
        <p className="caption">Goes to {approver} for approval. The same checks run again on the server.</p>
        {person.id === "E01" ? <p className="caption">Quick test: the dates below are 7 to 9 Dec 2026. Submit them, then sign in as Rajesh Kumar to approve.</p> : null}
        <ApplyForm state={personal} employeeId={person.id} defaults={defaults} />
      </section>
      <section className="card">
        <h2>My applications</h2>
        {mine.length === 0 ? <p>You have not applied yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Leave</th><th>Dates</th><th className="num">Days</th><th>Status</th><th>Status trail</th><th></th></tr></thead>
              <tbody>
                {mine.map((request) => (
                  <tr key={request.id}>
                    <RequestLine request={request} />
                    <td>
                      {docFor.get(request.id) ? <Link href={`/api/documents/${docFor.get(request.id)}`}>Download</Link> : null}
                      {request.status === "Pending" || (request.status === "Approved" && request.start >= state.today && request.pendingAction === "NONE") ? (
                        <ActionForm action={cancelLeave}>
                          <input type="hidden" name="id" value={request.id} />
                          <button className="btn" type="submit">{request.status === "Pending" ? "Cancel" : "Request cancellation"}</button>
                        </ActionForm>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {mine.filter((request) => request.status === "Pending").map((request) => (
          <details key={request.id} style={{ marginTop: "0.8rem" }}>
            <summary>Change pending {request.id}</summary>
            <ActionForm action={amendLeave}>
              <input type="hidden" name="id" value={request.id} />
              <div className="grid">
                <label className="field"><span>Type</span>
                  <select name="type" defaultValue={request.type}>{CORE_TYPES.concat(PARENTAL_TYPES).map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select>
                </label>
                <label className="field"><span>Duration</span>
                  <select name="unit" defaultValue={request.unit}><option value="full">Full day(s)</option><option value="am">Half day (AM)</option><option value="pm">Half day (PM)</option><option value="hours">Hours (time off)</option></select>
                </label>
                <label className="field"><span>From</span><input type="date" name="start" defaultValue={request.start} required /></label>
                <label className="field"><span>To</span><input type="date" name="end" defaultValue={request.end} required /></label>
                <label className="field"><span>Hours</span><input name="hours" type="number" min={1} max={7} defaultValue={request.hours || 4} /></label>
                <label className="field"><span>Reason</span><input name="reason" defaultValue={request.reason} /></label>
                <label className="field"><span>Replace document</span><input name="file" type="file" accept="image/*,.pdf" /></label>
              </div>
              <button className="btn" type="submit">Save change</button>
            </ActionForm>
          </details>
        ))}
      </section>
    </>
  );
}
