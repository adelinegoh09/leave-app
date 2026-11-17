import { redirect } from "next/navigation";
import { YearLinks } from "@/components/status";
import { fmtD } from "@/lib/leave/dates";
import { LEAVE_TYPES, type LeaveType } from "@/lib/leave/types";
import { currentEmployee, loadState } from "@/server/store";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const me = await currentEmployee();
  if (me.role === "EMPLOYEE") redirect("/");
  const query = await searchParams;
  const year = query.year === "2027" ? 2027 : 2026;
  const state = await loadState();
  const people = me.role === "HR_ADMIN" ? state.employees : state.employees.filter((person) => person.approverId === me.id || person.secondApproverId === me.id);
  const taken = (id: string, type: LeaveType) =>
    state.requests.filter((request) => request.employeeId === id && request.type === type && request.status === "Approved" && (type === "OIL" || Number(request.start.slice(0, 4)) === year)).reduce((sum, request) => sum + request.days, 0);
  const totals = LEAVE_TYPES.map((type) => ({ type, days: people.reduce((sum, person) => sum + taken(person.id, type.value), 0) }));
  const max = Math.max(1, ...totals.map((row) => row.days));
  return (
    <section className="card">
      <h1>Leave taken{me.role === "MANAGER" ? " for your team" : ""}</h1>
      <p className="caption">Approved days in {year}. Payroll and government claim files are on the HR page.</p>
      <YearLinks year={year} base="/reports" />
      <div className="bars" style={{ margin: "1rem 0" }}>
        {totals.filter((row) => row.days > 0).sort((a, b) => b.days - a.days).map((row) => (
          <div className="bar-row" key={row.type.value}>
            <span>{row.type.label}</span>
            <div className="bar"><span style={{ width: `${(row.days / max) * 100}%` }} /></div>
            <strong>{fmtD(row.days)} days</strong>
          </div>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              {LEAVE_TYPES.map((type) => <th key={type.value} className="num">{type.short}</th>)}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {people.map((person) => {
              const values = LEAVE_TYPES.map((type) => taken(person.id, type.value));
              return (
                <tr key={person.id}>
                  <td>{person.name}</td>
                  {values.map((value, index) => <td key={LEAVE_TYPES[index].value} className="num">{fmtD(value)}</td>)}
                  <td className="num">{fmtD(values.reduce((sum, value) => sum + value, 0))}</td>
                </tr>
              );
            })}
            <tr>
              <td>Total</td>
              {totals.map((row) => <td key={row.type.value} className="num">{fmtD(row.days)}</td>)}
              <td className="num">{fmtD(totals.reduce((sum, row) => sum + row.days, 0))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: "0.8rem" }}><a className="btn" href={`/api/export?kind=balances&year=${year}`}>Download balance CSV</a></p>
    </section>
  );
}
