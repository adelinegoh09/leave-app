import { NextResponse } from "next/server";
import { fmtD } from "@/lib/leave/dates";
import { balance, claimRows, payrollRows, toCsv, PAY_HEAD } from "@/lib/leave/engine";
import { LEAVE_TYPES } from "@/lib/leave/types";
import { currentEmployee, loadState } from "@/server/store";

export async function GET(request: Request) {
  const me = await currentEmployee();
  if (me.role === "EMPLOYEE") return new NextResponse("Managers and HR only", { status: 403 });
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") || "balances";
  const state = await loadState();
  if (kind === "payroll" || kind === "claims") {
    if (me.role !== "HR_ADMIN") return new NextResponse("HR only", { status: 403 });
  }
  let csv = "";
  let name = "leave.csv";
  if (kind === "payroll") {
    const month = url.searchParams.get("month") || "All";
    csv = toCsv(PAY_HEAD, payrollRows(state, month));
    name = `leave_payroll_${month}.csv`;
  } else if (kind === "claims") {
    const year = Number(url.searchParams.get("year") || state.today.slice(0, 4));
    const rows = claimRows(state, year);
    csv = toCsv(
      ["Employee ID", "Name", "Scheme", "Start", "End", "Days", "Employer-paid days", "Reimbursable days", "Cap", "Child", "Statutory"],
      rows.map((row) => [row.employeeId, row.name, row.scheme, row.start, row.end, row.days, row.employerPaidDays, row.reimbursableDays, row.dailyCap, row.child, row.statutory]),
    );
    name = `leave_claims_${year}.csv`;
  } else {
    const year = Number(url.searchParams.get("year") || "2026");
    const people = me.role === "HR_ADMIN" ? state.employees : state.employees.filter((person) => person.approverId === me.id || person.secondApproverId === me.id);
    const header = ["Employee ID", "Name", "Group", "Category", "Employment Act", ...LEAVE_TYPES.flatMap((type) => [`${type.short} entitlement`, `${type.short} available`])];
    const body = people.map((person) => [
      person.id,
      person.name,
      person.group,
      person.category,
      person.employmentActCovered ? "Yes" : "No",
      ...LEAVE_TYPES.flatMap((type) => {
        const row = balance(state, person, type.value, year);
        return [row.ent.total === null ? "" : fmtD(row.ent.total), row.avail === null ? "" : fmtD(row.avail)];
      }),
    ]);
    csv = toCsv(header, body);
    name = `leave_balances_${year}.csv`;
  }
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
