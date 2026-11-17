import { MonthCalendar } from "@/components/month-calendar";
import { StatusBadge } from "@/components/status";
import { fmtD, monthName } from "@/lib/leave/dates";
import { calendarEvents, dateLabel, empOf, groupsIn, requestDates } from "@/lib/leave/engine";
import { typeInfo } from "@/lib/leave/types";
import { loadState } from "@/server/store";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; group?: string }> }) {
  const query = await searchParams;
  const state = await loadState();
  const month = /^\d{4}-\d{2}$/.test(query.month || "") ? query.month! : state.today.slice(0, 7);
  const group = query.group || "All";
  const events = calendarEvents(state, month, group);
  const away = state.requests
    .filter((request) => (request.status === "Approved" || request.status === "Pending") && (group === "All" || empOf(state, request.employeeId)?.group === group) && requestDates(state, request).some((date) => date.startsWith(month)))
    .sort((a, b) => (a.start < b.start ? -1 : 1));
  const months: string[] = [];
  for (let year = 2026; year <= 2027; year++) for (let m = 1; m <= 12; m++) months.push(`${year}-${String(m).padStart(2, "0")}`);
  return (
    <section className="card">
      <h1>Team calendar</h1>
      <p className="caption">Approved and pending leave by working day, with Singapore public holidays.</p>
      <form className="grid" method="get">
        <label className="field"><span>Month</span>
          <select name="month" defaultValue={month}>{months.map((value) => <option key={value} value={value}>{monthName(value)}</option>)}</select>
        </label>
        <label className="field"><span>Team</span>
          <select name="group" defaultValue={group}>
            <option value="All">Everyone</option>
            {groupsIn(state).map((name) => <option key={name}>{name}</option>)}
          </select>
        </label>
        <button className="btn" type="submit">Show</button>
      </form>
      <div style={{ marginTop: "0.8rem" }}><MonthCalendar month={month} today={state.today} events={events} /></div>
      {away.length ? (
        <div className="table-wrap" style={{ marginTop: "1rem" }}>
          <table>
            <thead><tr><th>Employee</th><th>Group</th><th>Leave</th><th>Dates</th><th className="num">Days</th><th>Status</th></tr></thead>
            <tbody>
              {away.map((request) => {
                const employee = empOf(state, request.employeeId);
                return (
                  <tr key={request.id}>
                    <td>{employee?.name}</td>
                    <td>{employee?.group}</td>
                    <td>{typeInfo(request.type).label}</td>
                    <td>{dateLabel(request)}</td>
                    <td className="num">{fmtD(request.days)}</td>
                    <td><StatusBadge status={request.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p>No one is on leave in {monthName(month)} for this team.</p>}
    </section>
  );
}
