import { redirect } from "next/navigation";
import { fmtD } from "@/lib/leave/dates";
import { balance } from "@/lib/leave/engine";
import type { EmployeeRecord, LeaveType } from "@/lib/leave/types";
import { currentEmployee, loadState } from "@/server/store";

function cell(state: Parameters<typeof balance>[0], employee: EmployeeRecord, type: LeaveType) {
  const row = balance(state, employee, type, 2026);
  return `${fmtD(row.avail || 0)} of ${fmtD(row.ent.total || 0)}`;
}

export default async function TeamPage() {
  const me = await currentEmployee();
  if (me.role === "EMPLOYEE") redirect("/");
  const state = await loadState();
  const people = me.role === "HR_ADMIN" ? state.employees : state.employees.filter((person) => person.approverId === me.id || person.secondApproverId === me.id);
  return (
    <section className="card">
      <h1>Team balances for 2026</h1>
      <p className="caption">Available after pending requests, of the full entitlement.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Employee</th><th>Group</th><th className="num">Annual</th><th className="num">MC</th><th className="num">Hosp.</th><th className="num">Childcare</th><th className="num">Off-in-lieu</th><th className="num">Unpaid taken</th></tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.id}>
                <td>{person.name}</td>
                <td>{person.group}</td>
                <td className="num">{cell(state, person, "AL")}</td>
                <td className="num">{cell(state, person, "SL")}</td>
                <td className="num">{cell(state, person, "HL")}</td>
                <td className="num">{cell(state, person, "CCL")}</td>
                <td className="num">{cell(state, person, "OIL")}</td>
                <td className="num">{fmtD(balance(state, person, "NPL", 2026).taken)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
