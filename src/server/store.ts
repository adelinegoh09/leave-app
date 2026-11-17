import { cache } from "react";
import type { BlackoutMode, LeaveType, LeaveUnit, PendingAction, PolicyStatus, RequestStatus, Role, StepStatus, WorkPattern } from "@prisma/client";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { asDate, isoDate, singaporeToday } from "@/lib/leave/dates";
import { validateRules } from "@/lib/leave/rules";
import type { Actor, AppState, Draft, LeaveType as LeaveCode, RequestRecord as EngineRequest, Unit as EngineUnit } from "@/lib/leave/types";
import { prisma } from "@/lib/db";

const STATUS_FROM: Record<RequestStatus, EngineRequest["status"]> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};
const STATUS_TO: Record<EngineRequest["status"], RequestStatus> = {
  Pending: "PENDING",
  Approved: "APPROVED",
  Rejected: "REJECTED",
  Cancelled: "CANCELLED",
};
const UNIT_FROM: Record<LeaveUnit, EngineUnit> = { FULL: "full", AM: "am", PM: "pm", HOURS: "hours" };
const UNIT_TO: Record<EngineUnit, LeaveUnit> = { full: "FULL", am: "AM", pm: "PM", hours: "HOURS" };
const STEP_FROM: Record<StepStatus, EngineRequest["steps"][number]["status"]> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  WAITING: "Waiting",
};
const STEP_TO: Record<EngineRequest["steps"][number]["status"], StepStatus> = {
  Pending: "PENDING",
  Approved: "APPROVED",
  Rejected: "REJECTED",
  Waiting: "WAITING",
};
const ACTION_FROM: Record<PendingAction, EngineRequest["pendingAction"]> = { NONE: "NONE", CANCEL: "CANCEL" };

export const currentEmployee = cache(async () => {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) redirect("/login");
  const employee = await prisma.employee.findUnique({ where: { email }, include: { group: true } });
  if (!employee || !employee.active) redirect("/login");
  return employee;
});

export function toActor(employee: { id: string; name: string; role: Role }): Actor {
  return { id: employee.id, name: employee.name, role: employee.role };
}

export const loadState = cache(async (): Promise<AppState> => {
  const [employees, requests, credits, blackouts, policies, holidays, opening, delegations, counter] = await Promise.all([
    prisma.employee.findMany({ include: { group: true, children: true }, orderBy: { id: "asc" } }),
    prisma.leaveRequest.findMany({ include: { steps: { orderBy: { level: "asc" } }, trail: { orderBy: { at: "asc" } } } }),
    prisma.oilCredit.findMany(),
    prisma.blackout.findMany({ include: { group: true } }),
    prisma.policyVersion.findMany({ orderBy: { effectiveFrom: "asc" } }),
    prisma.publicHoliday.findMany(),
    prisma.openingBalance.findMany(),
    prisma.delegation.findMany(),
    prisma.counter.findUnique({ where: { id: "request" } }),
  ]);
  return {
    today: singaporeToday(),
    seq: counter?.value ?? 201,
    employees: employees.map((employee) => ({
      id: employee.id,
      email: employee.email,
      name: employee.name,
      shortName: employee.shortName,
      title: employee.title,
      role: employee.role,
      category: employee.category,
      employmentActCovered: employee.employmentActCovered,
      policyGroup: employee.policyGroup,
      group: employee.group.name,
      workPattern: employee.workPattern,
      joined: isoDate(employee.joinedOn),
      approverId: employee.approverId,
      secondApproverId: employee.secondApproverId,
      active: employee.active,
      children: employee.children.map((child) => ({
        name: child.name,
        dateOfBirth: isoDate(child.dateOfBirth),
        citizen: child.singaporeCitizen,
      })),
    })),
    requests: requests.map((request) => ({
      id: request.id,
      employeeId: request.employeeId,
      type: request.type,
      unit: UNIT_FROM[request.unit],
      start: isoDate(request.startDate),
      end: isoDate(request.endDate),
      hours: Number(request.hours),
      days: Number(request.days),
      reason: request.reason,
      fileName: request.fileName,
      status: STATUS_FROM[request.status],
      pendingAction: ACTION_FROM[request.pendingAction],
      band: request.band,
      warnings: request.warnings,
      steps: request.steps.map((step) => ({ level: step.level, approverId: step.approverId, status: STEP_FROM[step.status] })),
      trail: request.trail.map((entry) => ({ at: entry.at.toISOString(), by: entry.actorName, action: entry.action, note: entry.note })),
      policyId: request.policyVersionId,
    })),
    credits: credits.map((credit) => ({
      id: credit.id,
      employeeId: credit.employeeId,
      days: Number(credit.days),
      date: isoDate(credit.workedOn),
      reason: credit.reason,
      expiresOn: credit.expiresOn ? isoDate(credit.expiresOn) : null,
    })),
    blackouts: blackouts.map((blackout) => ({
      id: blackout.id,
      start: isoDate(blackout.startDate),
      end: isoDate(blackout.endDate),
      scope: blackout.scopeAll ? "All" : blackout.group?.name || "All",
      mode: blackout.mode === "BLOCK" ? "Block" : "Warn",
      label: blackout.label,
    })),
    policies: policies.flatMap((policy) => {
      const rules = validateRules(policy.rules);
      if (!rules.ok) return [];
      return [
        {
          id: policy.id,
          name: policy.name,
          policyGroup: policy.policyGroup,
          effectiveFrom: isoDate(policy.effectiveFrom),
          effectiveTo: policy.effectiveTo ? isoDate(policy.effectiveTo) : null,
          status: policy.status as PolicyStatus,
          rules: rules.rules,
          changeNote: policy.changeNote,
        },
      ];
    }),
    holidays: Object.fromEntries(holidays.map((holiday) => [isoDate(holiday.date), holiday.name])),
    openingCarry: opening.map((row) => ({
      employeeId: row.employeeId,
      year: row.year,
      type: row.leaveType,
      days: Number(row.carriedDays),
    })),
    delegations: delegations.map((row) => ({
      id: row.id,
      fromId: row.fromId,
      toId: row.toId,
      start: isoDate(row.startDate),
      end: isoDate(row.endDate),
    })),
  };
});

export async function persistRequest(request: EngineRequest): Promise<void> {
  const data = {
    employeeId: request.employeeId,
    type: request.type as LeaveType,
    unit: UNIT_TO[request.unit],
    startDate: asDate(request.start),
    endDate: asDate(request.end),
    hours: request.hours,
    days: request.days,
    reason: request.reason,
    fileName: request.fileName,
    status: STATUS_TO[request.status],
    pendingAction: request.pendingAction,
    band: request.band,
    warnings: request.warnings,
    year: Number(request.start.slice(0, 4)),
    policyVersionId: request.policyId,
    submittedAt: new Date(request.trail[0]?.at || Date.now()),
  };
  await prisma.$transaction(async (tx) => {
    await tx.leaveRequest.upsert({
      where: { id: request.id },
      create: { id: request.id, ...data },
      update: data,
    });
    await tx.approvalStep.deleteMany({ where: { requestId: request.id } });
    if (request.steps.length) {
      await tx.approvalStep.createMany({
        data: request.steps.map((step) => ({
          requestId: request.id,
          level: step.level,
          approverId: step.approverId,
          status: STEP_TO[step.status],
        })),
      });
    }
    await tx.leaveTrail.deleteMany({ where: { requestId: request.id } });
    if (request.trail.length) {
      await tx.leaveTrail.createMany({
        data: request.trail.map((entry) => ({
          requestId: request.id,
          at: new Date(entry.at),
          actorName: entry.by,
          action: entry.action,
          note: entry.note,
        })),
      });
    }
  });
}

export async function saveSeq(value: number): Promise<void> {
  await prisma.counter.upsert({ where: { id: "request" }, update: { value }, create: { id: "request", value } });
}

export function draftFromForm(employeeId: string, formData: FormData, hasFile: boolean): Draft {
  const type = String(formData.get("type") || "AL") as LeaveCode;
  const unit = String(formData.get("unit") || "full") as EngineUnit;
  return {
    employeeId,
    type,
    unit,
    start: String(formData.get("start") || ""),
    end: String(formData.get("end") || ""),
    hours: Number(formData.get("hours") || 0),
    reason: String(formData.get("reason") || ""),
    hasFile,
    fileName: String(formData.get("fileName") || ""),
    childDateOfBirth: String(formData.get("childDob") || "") || undefined,
    childCitizen: formData.get("childCitizen") === "yes",
    blackoutOverride: formData.get("blackoutOverride") === "yes",
    backdateOverride: formData.get("backdateOverride") === "yes",
    overrideReason: String(formData.get("overrideReason") || ""),
  };
}

export async function rememberChild(employeeId: string, draft: Draft): Promise<void> {
  if (!draft.childDateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(draft.childDateOfBirth)) return;
  const existing = await prisma.child.findFirst({ where: { employeeId, dateOfBirth: asDate(draft.childDateOfBirth) } });
  if (existing) return;
  await prisma.child.create({
    data: {
      employeeId,
      name: "Child",
      dateOfBirth: asDate(draft.childDateOfBirth),
      singaporeCitizen: Boolean(draft.childCitizen),
    },
  });
}

export function patternOf(value: string): WorkPattern {
  return value === "SIX_DAY" ? "SIX_DAY" : "FIVE_DAY";
}

export function blackoutMode(value: string): BlackoutMode {
  return value === "Warn" ? "WARN" : "BLOCK";
}
