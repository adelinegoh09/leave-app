import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { DecisionButtons } from "@/components/decision-buttons";
import { StatusBadge } from "@/components/status";
import { formatStamp, fmtD, nice } from "@/lib/leave/dates";
import { balance, dateLabel, empOf, isOverdue, queueFor, requestEnd } from "@/lib/leave/engine";
import { typeInfo } from "@/lib/leave/types";
import { decideLeave } from "@/server/leave-actions";
import { removeDelegation, saveDelegation } from "@/server/hr-actions";
import { prisma } from "@/lib/db";
import { currentEmployee, loadState, toActor } from "@/server/store";

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const query = await searchParams;
  const me = await currentEmployee();
  const state = await loadState();
  const actor = toActor(me);
  const items = queueFor(state, actor);
  const decided = state.requests.filter((request) => request.steps.some((step) => step.approverId === me.id) && (request.status === "Approved" || request.status === "Rejected"));
  const docs = await prisma.document.findMany({ where: { requestId: { in: items.map((request) => request.id) } } });
  const docFor = new Map(docs.map((doc) => [doc.requestId, doc.id]));
  return (
    <>
      {query.notice ? <p className="flash">{query.notice}</p> : null}
      <section className="card">
        <h1>Approval queue</h1>
        <p className="caption">Requests waiting for you, including any you are covering as a backup approver.</p>
        {items.length === 0 ? <p>Nothing is waiting for you right now.</p> : null}
        {items.map((request) => {
          const employee = empOf(state, request.employeeId);
          if (!employee) return null;
          const year = Number(request.start.slice(0, 4));
          const bal = balance(state, employee, request.type, year);
          const away = state.requests.filter((other) => other.id !== request.id && (other.status === "Approved" || other.status === "Pending") && empOf(state, other.employeeId)?.group === employee.group && other.start <= requestEnd(request) && requestEnd(other) >= request.start);
          return (
            <article key={request.id} style={{ borderTop: "1px solid var(--line)", paddingTop: "0.8rem", marginTop: "0.8rem" }}>
              <h2>{employee.name}: {typeInfo(request.type).label}</h2>
              {request.pendingAction === "CANCEL" ? <p><span className="badge warn">Cancellation requested</span></p> : null}
              {isOverdue(state, request) ? <p><span className="badge bad">Overdue</span> Past the {state.policies.find((policy) => policy.id === request.policyId)?.rules.escalationHours || 24}-hour escalation point. A named backup can decide it.</p> : null}
              <dl className="grid">
                <div><dt className="label">Employee</dt><dd>{employee.title}, {employee.group}</dd></div>
                <div><dt className="label">Dates</dt><dd>{dateLabel(request)}</dd></div>
                <div><dt className="label">Working days</dt><dd>{fmtD(request.days)}</dd></div>
                <div><dt className="label">Balance</dt><dd>{bal.avail === null ? `Unpaid, ${fmtD(request.days)} day(s) to deduct in payroll` : `${fmtD(bal.avail)} of ${fmtD(bal.ent.total || 0)} left once this is approved`}</dd></div>
                <div><dt className="label">Reason</dt><dd>{request.reason || "None given"}</dd></div>
                <div><dt className="label">Attachment</dt><dd>{docFor.get(request.id) ? <Link href={`/api/documents/${docFor.get(request.id)}`}>{request.fileName || "Download"}</Link> : request.fileName || "None"}</dd></div>
                <div><dt className="label">Also away</dt><dd>{away.length ? away.map((other) => `${empOf(state, other.employeeId)?.name} (${typeInfo(other.type).short}${other.status === "Pending" ? ", pending" : ""})`).join(", ") : `No one else in ${employee.group}`}</dd></div>
                <div><dt className="label">Submitted</dt><dd>{formatStamp(request.trail[0]?.at || "")}</dd></div>
                {request.warnings.length ? <div><dt className="label">Blackout</dt><dd>{request.warnings.join(" ")}</dd></div> : null}
              </dl>
              <ActionForm action={decideLeave}>
                <input type="hidden" name="id" value={request.id} />
                <label className="field"><span>Comment (needed to reject)</span><input name="note" placeholder="Add a note for the employee" /></label>
                <DecisionButtons
                  approveLabel={request.pendingAction === "CANCEL" ? "Approve cancellation" : "Approve"}
                  rejectLabel={request.pendingAction === "CANCEL" ? "Keep the leave" : "Reject"}
                />
              </ActionForm>
            </article>
          );
        })}
      </section>
      <section className="card">
        <h2>Backup approver</h2>
        <p className="caption">Name someone who can approve while you are at sea or on leave. They only see the requests in your queue.</p>
        <ActionForm action={saveDelegation}>
          <div className="grid">
            <label className="field"><span>Backup</span>
              <select name="toId" defaultValue="E05">
                {state.employees.filter((person) => person.id !== me.id && person.active).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
            </label>
            <label className="field"><span>From</span><input type="date" name="start" defaultValue={state.today} required /></label>
            <label className="field"><span>To</span><input type="date" name="end" defaultValue="2026-12-31" required /></label>
          </div>
          <button className="btn primary" type="submit">Save backup</button>
        </ActionForm>
        {state.delegations.filter((item) => item.fromId === me.id).map((item) => (
          <form key={item.id} action={removeDelegation} className="row" style={{ marginTop: "0.5rem" }}>
            <input type="hidden" name="id" value={item.id} />
            <span>{empOf(state, item.toId)?.name} from {nice(item.start)} to {nice(item.end)}</span>
            <button className="btn" type="submit">Remove</button>
          </form>
        ))}
      </section>
      {decided.length ? (
        <section className="card">
          <h2>Decided requests</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Employee</th><th>Leave</th><th>Dates</th><th className="num">Days</th><th>Status</th></tr></thead>
              <tbody>
                {decided.map((request) => (
                  <tr key={request.id}>
                    <td>{empOf(state, request.employeeId)?.name}</td>
                    <td>{typeInfo(request.type).label}</td>
                    <td>{dateLabel(request)}</td>
                    <td className="num">{fmtD(request.days)}</td>
                    <td><StatusBadge status={request.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
