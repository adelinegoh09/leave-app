import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { DecisionButtons } from "@/components/decision-buttons";
import { fmtD, formatStamp, monthName, nice } from "@/lib/leave/dates";
import { balance, carryIn, dateLabel, empOf, payrollRows, queueFor, toCsv, PAY_HEAD } from "@/lib/leave/engine";
import { typeInfo } from "@/lib/leave/types";
import { summariseRules } from "@/lib/leave/rules";
import { activatePolicy, addBlackout, addHoliday, creditOffInLieu, importEmployees, publishPolicy, removeBlackout, saveCarryForward } from "@/server/hr-actions";
import { decideLeave, submitLeave } from "@/server/leave-actions";
import { currentEmployee, loadState, toActor } from "@/server/store";
import { prisma } from "@/lib/db";

export default async function HrPage({ searchParams }: { searchParams: Promise<{ notice?: string; month?: string }> }) {
  const me = await currentEmployee();
  if (me.role !== "HR_ADMIN") redirect("/");
  const query = await searchParams;
  const state = await loadState();
  const actor = toActor(me);
  const queue = queueFor(state, actor);
  const month = query.month || "2026-11";
  const rows = payrollRows(state, month);
  const csv = toCsv(PAY_HEAD, rows);
  const unpaid = rows.reduce((sum, row) => sum + Number(row[8] || 0), 0);
  const shore = state.policies.find((policy) => policy.policyGroup === "SHORE" && policy.status === "ACTIVE");
  const groups = [...new Set(state.employees.map((person) => person.group))];
  const audit = await prisma.auditLog.findMany({ orderBy: { at: "desc" }, take: 40 });
  return (
    <>
      {query.notice ? <p className="flash">{query.notice}</p> : null}
      <section className="card">
        <h1>HR admin</h1>
        <p className="caption">Policies, blackouts, opening balances, payroll export and the audit log. Requests from managers come here when their approver is HR.</p>
        <div className="subnav">
          <a href="#queue">Queue</a><a href="#balances">Balances</a><a href="#oil">Off-in-lieu</a><a href="#blackouts">Blackouts</a>
          <a href="#carry">Carry-forward</a><a href="#policies">Policies</a><a href="#payroll">Payroll</a><a href="#import">Import</a><a href="#audit">Audit</a>
        </div>
      </section>

      <section className="card" id="queue">
        <h2>Approval queue for HR</h2>
        {queue.length === 0 ? <p>Nothing is waiting for HR.</p> : queue.map((request) => {
          const employee = empOf(state, request.employeeId);
          if (!employee) return null;
          return (
            <article key={request.id} style={{ marginTop: "0.8rem" }}>
              <h3>{employee.name}: {typeInfo(request.type).label}</h3>
              <p>{dateLabel(request)} · {request.days} day(s) · {request.reason || "No reason"}</p>
              <ActionForm action={decideLeave}>
                <input type="hidden" name="id" value={request.id} />
                <label className="field"><span>Comment</span><input name="note" /></label>
                <DecisionButtons approveLabel="Approve" rejectLabel="Reject" />
              </ActionForm>
            </article>
          );
        })}
      </section>

      <section className="card" id="balances">
        <h2>All balances for 2026</h2>
        <p className="caption">Available after pending requests, of the full entitlement. <Link href="/team">Open the full table</Link></p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Employee</th><th>Group</th><th>Covered by Employment Act</th><th>Policy</th><th></th></tr></thead>
            <tbody>
              {state.employees.map((person) => (
                <tr key={person.id}>
                  <td>{person.name}<div className="caption">{person.title}</div></td>
                  <td>{person.group}</td>
                  <td>{person.employmentActCovered ? "Yes" : "No, crew contract"}</td>
                  <td>{person.policyGroup}</td>
                  <td><Link href={`/hr/employees/${person.id}`}>Edit</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" id="oil">
        <h2>Credit off-in-lieu</h2>
        <ActionForm action={creditOffInLieu}>
          <div className="grid">
            <label className="field"><span>Employee</span>
              <select name="employeeId" defaultValue="E08">{state.employees.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
            </label>
            <label className="field"><span>Days</span>
              <select name="days" defaultValue="1">{["0.5", "1", "1.5", "2", "3"].map((days) => <option key={days}>{days}</option>)}</select>
            </label>
            <label className="field"><span>Worked on</span><input type="date" name="date" defaultValue="2026-11-15" required /></label>
            <label className="field"><span>Use by (optional)</span><input type="date" name="expires" /></label>
            <label className="field"><span>Reason</span><input name="reason" placeholder="Worked on a rest day" required /></label>
          </div>
          <button className="btn primary" type="submit">Credit off-in-lieu</button>
        </ActionForm>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Employee</th><th className="num">Days</th><th>Worked on</th><th>Reason</th></tr></thead>
            <tbody>
              {state.credits.map((credit) => (
                <tr key={credit.id}><td>{empOf(state, credit.employeeId)?.name}</td><td className="num">{fmtD(credit.days)}</td><td>{nice(credit.date)}</td><td>{credit.reason}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" id="blackouts">
        <h2>Blackout dates</h2>
        <p className="caption">Apply to annual, off-in-lieu and unpaid leave. Sick, hospitalisation, childcare and parental leave are never blocked.</p>
        <ActionForm action={addBlackout}>
          <div className="grid">
            <label className="field"><span>From</span><input type="date" name="start" defaultValue="2026-12-14" required /></label>
            <label className="field"><span>To</span><input type="date" name="end" defaultValue="2026-12-18" required /></label>
            <label className="field"><span>Applies to</span>
              <select name="scope" defaultValue="MT Marina Star"><option>All</option>{groups.map((group) => <option key={group}>{group}</option>)}</select>
            </label>
            <label className="field"><span>When someone applies</span>
              <select name="mode" defaultValue="Block"><option value="Block">Block the application</option><option value="Warn">Warn but allow</option></select>
            </label>
            <label className="field"><span>Label</span><input name="label" placeholder="Charter peak" required /></label>
          </div>
          <button className="btn primary" type="submit">Add blackout</button>
        </ActionForm>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Label</th><th>Dates</th><th>Applies to</th><th>Rule</th><th></th></tr></thead>
            <tbody>
              {state.blackouts.map((blackout) => (
                <tr key={blackout.id}>
                  <td>{blackout.label}</td><td>{nice(blackout.start)} to {nice(blackout.end)}</td><td>{blackout.scope === "All" ? "Everyone" : blackout.scope}</td><td>{blackout.mode === "Block" ? "Blocked" : "Warning only"}</td>
                  <td><form action={removeBlackout}><input type="hidden" name="id" value={blackout.id} /><button className="btn" type="submit">Remove</button></form></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" id="carry">
        <h2>Carry-forward</h2>
        <p className="caption">Saving publishes a new policy version for every active group, effective today. Unused annual leave moves into the next year up to the cap, and must be used by the date below.</p>
        <ActionForm action={saveCarryForward}>
          <div className="grid">
            <label className="field"><span>Most days carried forward</span><input name="cap" type="number" min={0} max={14} defaultValue={shore?.rules.carryForward.cap ?? 5} /></label>
            <label className="field"><span>Carried days must be used by</span><input type="date" name="expiry" defaultValue={shore?.rules.carryForward.expiry || "2027-03-31"} required /></label>
          </div>
          <button className="btn primary" type="submit">Publish carry-forward</button>
        </ActionForm>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Employee</th><th className="num">2026 annual leave</th><th className="num">Taken</th><th className="num">Unused</th><th className="num">Carried into 2027</th></tr></thead>
            <tbody>
              {state.employees.map((person) => {
                const row = balance(state, person, "AL", 2026);
                const unusedDays = Math.max(0, (row.ent.total || 0) - row.taken);
                return <tr key={person.id}><td>{person.name}</td><td className="num">{fmtD(row.ent.total || 0)}</td><td className="num">{fmtD(row.taken)}</td><td className="num">{fmtD(unusedDays)}</td><td className="num">{fmtD(carryIn(state, person, 2027).days)}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" id="policies">
        <h2>Leave policies</h2>
        <p className="caption">Rules are versioned. The engine uses the active version whose dates cover the leave. The announced childcare increase is seeded as a draft and does nothing until you activate it.</p>
        {state.policies.map((policy) => (
          <article key={policy.id} style={{ marginTop: "0.8rem" }}>
            <h3>{policy.name}</h3>
            <p className="caption">{policy.policyGroup} · {policy.status} · from {nice(policy.effectiveFrom)}{policy.effectiveTo ? ` to ${nice(policy.effectiveTo)}` : ""} · {policy.changeNote}</p>
            <ul>{summariseRules(policy.rules).map((line) => <li key={line}>{line}</li>)}</ul>
            {policy.status === "DRAFT" ? (
              <form action={activatePolicy}><input type="hidden" name="id" value={policy.id} /><button className="btn" type="submit">Activate this version</button></form>
            ) : null}
          </article>
        ))}
        <h3>New version</h3>
        <ActionForm action={publishPolicy}>
          <div className="grid">
            <label className="field"><span>Name</span><input name="name" required /></label>
            <label className="field"><span>Policy group</span><input name="policyGroup" defaultValue="SHORE" required /></label>
            <label className="field"><span>Effective from</span><input type="date" name="effectiveFrom" defaultValue="2027-07-01" required /></label>
            <label className="field"><span>Status</span><select name="status"><option value="DRAFT">Draft</option><option value="ACTIVE">Active</option></select></label>
          </div>
          <label className="field"><span>What changed</span><input name="changeNote" required /></label>
          <label className="field"><span>Rules JSON</span><textarea name="rules" defaultValue={JSON.stringify(shore?.rules || {}, null, 2)} rows={14} /></label>
          <button className="btn primary" type="submit">Save policy version</button>
        </ActionForm>
        <h3>Public holiday</h3>
        <ActionForm action={addHoliday}>
          <div className="grid">
            <label className="field"><span>Date</span><input type="date" name="date" required /></label>
            <label className="field"><span>Name</span><input name="name" required /></label>
            <label className="field"><span>Observed day</span><select name="observed"><option value="no">No</option><option value="yes">Yes</option></select></label>
          </div>
          <button className="btn" type="submit">Save holiday</button>
        </ActionForm>
      </section>

      <section className="card" id="payroll">
        <h2>Payroll export</h2>
        <p className="caption">Approved leave with working days in the month, and unpaid days for the pay run. CPF is still submitted by payroll.</p>
        <form method="get" className="row">
          <label className="field"><span>Month</span>
            <select name="month" defaultValue={month}>
              {["2026-10", "2026-11", "2026-12", "2027-01", "All"].map((value) => <option key={value} value={value}>{value === "All" ? "All approved leave" : monthName(value)}</option>)}
            </select>
          </label>
          <button className="btn" type="submit">Show</button>
          <a className="btn primary" href={`/api/export?kind=payroll&month=${month}`}>Download CSV</a>
          <a className="btn" href="/api/export?kind=claims&year=2026">Childcare and parental claim pack</a>
        </form>
        <p>Unpaid days in this export: {fmtD(unpaid)}.</p>
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Employee</th><th>Leave type</th><th>Start</th><th>End</th><th className="num">Days</th><th className="num">Unpaid</th><th>Approved by</th></tr></thead>
              <tbody>{rows.map((row, index) => <tr key={index}><td>{row[1]}</td><td>{row[3]}</td><td>{nice(row[4])}</td><td>{nice(row[5])}</td><td className="num">{row[7]}</td><td className="num">{row[8]}</td><td>{row[9]}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <p>No approved leave in this month yet.</p>}
        <pre className="csv">{csv}</pre>
      </section>

      <section className="card" id="apply">
        <h2>Apply on behalf</h2>
        <p className="caption">HR can backdate or override a blackout. Give the reason in the override box. The action is audited.</p>
        <ActionForm action={submitLeave}>
          <div className="grid">
            <label className="field"><span>Employee</span>
              <select name="employeeId">{state.employees.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
            </label>
            <label className="field"><span>Type</span>
              <select name="type"><option value="AL">Annual leave</option><option value="SL">Sick leave (MC)</option><option value="HL">Hospitalisation leave</option><option value="CCL">Childcare leave</option><option value="NPL">Unpaid leave</option><option value="OIL">Off-in-lieu</option></select>
            </label>
            <label className="field"><span>From</span><input type="date" name="start" required /></label>
            <label className="field"><span>To</span><input type="date" name="end" required /></label>
            <input type="hidden" name="unit" value="full" />
            <label className="field"><span>Reason</span><input name="reason" /></label>
            <label className="field"><span>Override reason</span><input name="overrideReason" /></label>
            <label className="field"><span>Overrides</span>
              <select name="blackoutOverride" defaultValue="no"><option value="no">No blackout override</option><option value="yes">Override blackout</option></select>
            </label>
            <label className="field"><span>Backdate</span>
              <select name="backdateOverride" defaultValue="no"><option value="no">No</option><option value="yes">Allow a past date</option></select>
            </label>
          </div>
          <button className="btn" type="submit">Submit for employee</button>
        </ActionForm>
      </section>

      <section className="card" id="import">
        <h2>Import employees</h2>
        <p className="caption">CSV columns match <a href="/employee-import-template.csv">the template</a>. Existing employee ids are updated. A password column is optional; otherwise the person signs in with Microsoft or an email link.</p>
        <ActionForm action={importEmployees}>
          <label className="field"><span>CSV file</span><input name="file" type="file" accept=".csv,text/csv" /></label>
          <label className="field"><span>Or paste CSV</span><textarea name="csv" placeholder="employee_id,email,name,group,joined_on" /></label>
          <button className="btn primary" type="submit">Import</button>
        </ActionForm>
      </section>

      <section className="card" id="audit">
        <h2>Audit log</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th></tr></thead>
            <tbody>
              {audit.map((entry) => (
                <tr key={entry.id}><td>{formatStamp(entry.at.toISOString())}</td><td>{entry.actorName}</td><td>{entry.action}</td><td>{entry.entityType} {entry.entityId}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
