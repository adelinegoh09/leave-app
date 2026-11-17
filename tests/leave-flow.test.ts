import { describe, expect, it } from "vitest";
import {
  actorCanDecide,
  amendApplication,
  balance,
  cancelApplication,
  checkDraft,
  claimRows,
  decideApplication,
  payrollRows,
  queueFor,
  submitApplication,
  toCsv,
  PAY_HEAD,
} from "@/lib/leave/engine";
import { buildSeedState } from "@/lib/leave/seed-data";
import type { Actor, AppState } from "@/lib/leave/types";

const state = buildSeedState();
const at = "2026-11-17T01:00:00.000Z";
const wei: Actor = { id: "E01", name: "Tan Wei Ming", role: "EMPLOYEE" };
const rajesh: Actor = { id: "E03", name: "Rajesh Kumar", role: "MANAGER" };
const hr: Actor = { id: "E11", name: "Adeline Goh", role: "HR_ADMIN" };
const jason: Actor = { id: "E05", name: "Jason Ong", role: "MANAGER" };

function apply(base: AppState, employeeId: string, actor: Actor, extra: Partial<Parameters<typeof submitApplication>[1]> = {}) {
  return submitApplication(
    base,
    {
      employeeId,
      type: "AL",
      unit: "full",
      start: "2026-12-07",
      end: "2026-12-09",
      hours: 0,
      reason: "Family",
      hasFile: false,
      ...extra,
    },
    actor,
    at,
  );
}

describe("apply and approve", () => {
  it("submits Tan Wei Ming's 7 to 9 Dec annual leave and lets Rajesh approve it", () => {
    const before = balance(state, state.employees[0], "AL", 2026);
    const submitted = apply(state, "E01", wei);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    expect(submitted.request.days).toBe(3);
    expect(submitted.request.status).toBe("Pending");
    expect(submitted.request.steps[0].approverId).toBe("E03");
    const pending = balance(submitted.state, state.employees[0], "AL", 2026);
    expect(pending.pending).toBe(before.pending + 3);
    expect(pending.avail).toBe((before.avail || 0) - 3);

    expect(queueFor(submitted.state, rajesh).some((r) => r.id === submitted.request.id)).toBe(true);
    expect(actorCanDecide(submitted.state, submitted.request, wei)).toBe(false);

    const rejected = decideApplication(submitted.state, submitted.request.id, false, rajesh, "  ", at);
    expect(rejected.ok).toBe(false);

    const approved = decideApplication(submitted.state, submitted.request.id, true, rajesh, "Covered", at);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.request.status).toBe("Approved");
    expect(approved.request.trail.map((t) => t.action)).toEqual(["Submitted", "Approved"]);
    const after = balance(approved.state, state.employees[0], "AL", 2026);
    expect(after.taken).toBe(before.taken + 3);
    expect(after.pending).toBe(before.pending);
  });

  it("requires an MC for sick leave and blocks a clash", () => {
    const missing = checkDraft(state, {
      employeeId: "E01",
      type: "SL",
      unit: "full",
      start: "2026-11-17",
      end: "2026-11-17",
      hours: 0,
      reason: "Fever",
      hasFile: false,
    });
    expect(missing.errors.join(" ")).toContain("MC");
    const filed = submitApplication(
      state,
      { employeeId: "E01", type: "SL", unit: "full", start: "2026-11-17", end: "2026-11-17", hours: 0, reason: "Fever", hasFile: true, fileName: "mc.jpg" },
      wei,
      at,
    );
    expect(filed.ok).toBe(true);
    const clash = checkDraft(state, {
      employeeId: "E01",
      type: "AL",
      unit: "full",
      start: "2026-12-28",
      end: "2026-12-30",
      hours: 0,
      reason: "",
      hasFile: false,
    });
    expect(clash.errors.join(" ")).toContain("already have");
  });

  it("warns on the year-end blackout and blocks the barge dry dock", () => {
    const warn = checkDraft(state, {
      employeeId: "E04",
      type: "AL",
      unit: "full",
      start: "2026-12-28",
      end: "2026-12-30",
      hours: 0,
      reason: "",
      hasFile: false,
    });
    expect(warn.errors).toEqual([]);
    expect(warn.warnings.join(" ")).toContain("Year-end closing");
    const block = checkDraft(state, {
      employeeId: "E09",
      type: "AL",
      unit: "full",
      start: "2027-01-04",
      end: "2027-01-06",
      hours: 0,
      reason: "",
      hasFile: false,
    });
    expect(block.errors.join(" ")).toContain("Dry dock");
    const override = submitApplication(
      state,
      {
        employeeId: "E09",
        type: "AL",
        unit: "full",
        start: "2027-01-04",
        end: "2027-01-06",
        hours: 0,
        reason: "Essential repair cover",
        hasFile: false,
        blackoutOverride: true,
        overrideReason: "Master requested HR to release him after the docking survey",
      },
      hr,
      at,
    );
    expect(override.ok).toBe(true);
  });

  it("counts time off in hours and half days", () => {
    const hours = checkDraft(state, {
      employeeId: "E02",
      type: "AL",
      unit: "hours",
      start: "2026-12-02",
      end: "2026-12-02",
      hours: 4,
      reason: "Appointment",
      hasFile: false,
    });
    expect(hours.days).toBe(0.5);
    expect(hours.errors).toEqual([]);
    const half = checkDraft(state, {
      employeeId: "E02",
      type: "AL",
      unit: "am",
      start: "2026-12-02",
      end: "2026-12-02",
      hours: 0,
      reason: "",
      hasFile: false,
    });
    expect(half.days).toBe(0.5);
  });

  it("cancels a pending request immediately and asks the approver to cancel an approved one", () => {
    const submitted = apply(state, "E02", { id: "E02", name: "Nur Aisyah binte Rahman", role: "EMPLOYEE" }, { start: "2026-12-14", end: "2026-12-14" });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const cancelled = cancelApplication(submitted.state, submitted.request.id, { id: "E02", name: "Nur Aisyah binte Rahman", role: "EMPLOYEE" }, at);
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.request.status).toBe("Cancelled");

    const approved = state.requests.find((r) => r.id === "L106");
    expect(approved?.status).toBe("Approved");
    const rajeshActor: Actor = { id: "E03", name: "Rajesh Kumar", role: "MANAGER" };
    const beforeTaken = balance(state, state.employees.find((e) => e.id === "E03")!, "AL", 2026).taken;
    const asked = cancelApplication(state, "L106", rajeshActor, at);
    expect(asked.ok).toBe(true);
    if (!asked.ok) return;
    expect(asked.request.status).toBe("Approved");
    expect(asked.request.pendingAction).toBe("CANCEL");
    expect(queueFor(asked.state, hr).some((r) => r.id === "L106")).toBe(true);
    const confirmed = decideApplication(asked.state, "L106", true, hr, "OK", at);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.request.status).toBe("Cancelled");
    expect(balance(confirmed.state, state.employees.find((e) => e.id === "E03")!, "AL", 2026).taken).toBe(0);
    expect(beforeTaken).toBeGreaterThan(0);
  });

  it("amends a pending request and refuses to edit an approved one in place", () => {
    const submitted = apply(state, "E01", wei);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const amended = amendApplication(
      submitted.state,
      submitted.request.id,
      { employeeId: "E01", type: "AL", unit: "full", start: "2026-12-07", end: "2026-12-07", hours: 0, reason: "One day only", hasFile: false },
      wei,
      at,
    );
    expect(amended.ok).toBe(true);
    if (!amended.ok) return;
    expect(amended.request.days).toBe(1);
    const approvedEdit = amendApplication(
      state,
      "L101",
      { employeeId: "E01", type: "AL", unit: "full", start: "2026-03-09", end: "2026-03-10", hours: 0, reason: "Shorter", hasFile: false },
      wei,
      at,
    );
    expect(approvedEdit.ok).toBe(false);
  });

  it("runs a second approval level before the request is approved", () => {
    const withSecond: AppState = {
      ...state,
      employees: state.employees.map((e) => (e.id === "E01" ? { ...e, secondApproverId: "E05" } : e)),
    };
    const submitted = apply(withSecond, "E01", wei);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const first = decideApplication(submitted.state, submitted.request.id, true, rajesh, "Fine", at);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.request.status).toBe("Pending");
    expect(queueFor(first.state, jason).some((r) => r.id === first.request.id)).toBe(true);
    expect(queueFor(first.state, rajesh).some((r) => r.id === first.request.id)).toBe(false);
    const second = decideApplication(first.state, first.request.id, true, jason, "Agreed", at);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.request.status).toBe("Approved");
  });

  it("lets a delegate approve while the manager is away", () => {
    const submitted = apply(state, "E01", wei);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const delegated: AppState = {
      ...submitted.state,
      delegations: [{ id: "D1", fromId: "E03", toId: "E05", start: "2026-11-01", end: "2026-11-30" }],
    };
    expect(actorCanDecide(delegated, submitted.request, jason)).toBe(true);
    const decided = decideApplication(delegated, submitted.request.id, true, jason, "Covering for Rajesh", at);
    expect(decided.ok).toBe(true);
    if (!decided.ok) return;
    expect(decided.request.status).toBe("Approved");
  });

  it("sends Rajesh's own leave to HR, and HR cannot approve her own", () => {
    expect(queueFor(state, hr).map((r) => r.employeeId)).toContain("E03");
    expect(queueFor(state, hr).map((r) => r.employeeId)).not.toContain("E01");
    const own = apply(state, "E11", hr, { start: "2026-12-14", end: "2026-12-14" });
    expect(own.ok).toBe(true);
    if (!own.ok) return;
    expect(actorCanDecide(own.state, own.request, hr)).toBe(false);
    expect(actorCanDecide(own.state, own.request, rajesh)).toBe(true);
  });
});

describe("exports", () => {
  it("builds the payroll CSV with unpaid days only on unpaid leave", () => {
    const rows = payrollRows(state, "2026-11");
    const csv = toCsv(PAY_HEAD, rows);
    expect(csv.split("\n")[0]).toBe(PAY_HEAD.join(","));
    const rizal = rows.find((r) => r[0] === "E08");
    expect(rizal?.[3]).toBe("Unpaid leave");
    expect(Number(rizal?.[8])).toBeGreaterThan(0);
    const paid = rows.find((r) => r[0] === "E06" && r[3].includes("Sick"));
    expect(paid?.[8]).toBe("0");
  });

  it("marks government-paid childcare for shore staff and leaves crew off the claim pack", () => {
    const rows = claimRows(state, 2026);
    expect(rows.some((r) => r.employeeId === "E01" && r.scheme.includes("Government-paid"))).toBe(true);
    expect(rows.some((r) => r.employeeId === "E09")).toBe(false);
    const wei = rows.find((r) => r.employeeId === "E01");
    expect(wei?.employerPaidDays).toBe("2");
    expect(wei?.reimbursableDays).toBe("0");
  });
});
