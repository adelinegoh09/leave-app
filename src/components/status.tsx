import { formatStamp, fmtD, nice } from "@/lib/leave/dates";
import { dateLabel, trailText } from "@/lib/leave/engine";
import { typeInfo, type RequestRecord, type ReqStatus } from "@/lib/leave/types";

export function StatusBadge({ status }: { status: ReqStatus | string }) {
  const tone = status === "Approved" ? "good" : status === "Rejected" ? "bad" : status === "Cancelled" ? "" : "warn";
  return <span className={`badge ${tone}`.trim()}>{status}</span>;
}

export function balanceRows(rows: { label: string; entitlement: string; taken: string; pending: string; available: string; note: string }[]) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Leave type</th><th className="num">Entitlement</th><th className="num">Taken</th><th className="num">Pending</th><th className="num">Available</th><th>How it is worked out</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td className="num">{row.entitlement}</td>
              <td className="num">{row.taken}</td>
              <td className="num">{row.pending}</td>
              <td className="num">{row.available}</td>
              <td>{row.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RequestLine({ request }: { request: RequestRecord }) {
  return (
    <>
      <td>{typeInfo(request.type).label}</td>
      <td>{dateLabel(request)}</td>
      <td className="num">{fmtD(request.days)}</td>
      <td><StatusBadge status={request.pendingAction === "CANCEL" ? "Cancel requested" : request.status} /></td>
      <td>{request.trail.map((entry) => `${entry.action} by ${entry.by}, ${formatStamp(entry.at)}${entry.note ? ` (${entry.note})` : ""}`).join("; ") || trailText(request)}{request.fileName ? `; attachment ${request.fileName}` : ""}</td>
    </>
  );
}

export function YearLinks({ year, base }: { year: number; base: string }) {
  return (
    <div className="row">
      {[2026, 2027].map((value) => (
        <a key={value} className="btn" href={`${base}${base.includes("?") ? "&" : "?"}year=${value}`} aria-current={year === value ? "page" : undefined} style={year === value ? { background: "#102033", color: "white" } : undefined}>{value}</a>
      ))}
    </div>
  );
}

export function niceRange(start: string, end: string) {
  return start === end ? nice(start) : `${nice(start)} to ${nice(end)}`;
}
