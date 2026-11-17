import { dateLabel, empOf } from "@/lib/leave/engine";
import { typeInfo } from "@/lib/leave/types";
import type { AppState, RequestRecord } from "@/lib/leave/types";
import { sendMail } from "@/lib/notify";

function appUrl(): string {
  return process.env.AUTH_URL || "http://localhost:3000";
}

export async function mailPeople(
  people: { email: string; id: string }[],
  subject: string,
  text: string,
): Promise<void> {
  await Promise.all(people.filter((person) => person.email).map((person) => sendMail({ to: person.email, subject, text, employeeId: person.id })));
}

export function approverRecipients(state: AppState, approverId: string | null): { email: string; id: string }[] {
  if (!approverId) {
    return state.employees.filter((person) => person.role === "HR_ADMIN" && person.active).map((person) => ({ email: person.email, id: person.id }));
  }
  const direct = empOf(state, approverId);
  const people = direct ? [{ email: direct.email, id: direct.id }] : [];
  for (const delegation of state.delegations) {
    if (delegation.fromId !== approverId || delegation.start > state.today || delegation.end < state.today) continue;
    const delegate = empOf(state, delegation.toId);
    if (delegate) people.push({ email: delegate.email, id: delegate.id });
  }
  return people;
}

export async function mailSubmitted(state: AppState, request: RequestRecord): Promise<void> {
  const employee = empOf(state, request.employeeId);
  const step = request.steps.find((item) => item.status === "Pending");
  const subject = `${employee?.name || "An employee"} applied for ${typeInfo(request.type).label.toLowerCase()}`;
  const text = `${employee?.name || "An employee"} submitted ${request.days} day(s) of ${typeInfo(request.type).label.toLowerCase()} (${dateLabel(request)}).\n\nOpen the approval queue: ${appUrl()}/approvals`;
  await mailPeople(approverRecipients(state, step?.approverId ?? null), subject, text);
}

export async function mailDecided(state: AppState, request: RequestRecord, approved: boolean): Promise<void> {
  const employee = empOf(state, request.employeeId);
  if (!employee) return;
  const pending = request.steps.find((step) => step.status === "Pending");
  if (approved && pending) {
    await mailPeople(
      approverRecipients(state, pending.approverId),
      `${employee.name}'s leave needs your approval`,
      `The previous approver accepted ${employee.name}'s ${typeInfo(request.type).label.toLowerCase()} (${dateLabel(request)}). It is now with you.\n\n${appUrl()}/approvals`,
    );
    return;
  }
  await sendMail({
    to: employee.email,
    employeeId: employee.id,
    subject: approved ? "Your leave was approved" : "Your leave was not approved",
    text: `${request.days} day(s) of ${typeInfo(request.type).label.toLowerCase()} (${dateLabel(request)}) was ${approved ? "approved" : "rejected"}.\n\n${appUrl()}/`,
  });
}
