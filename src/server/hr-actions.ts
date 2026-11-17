"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Category, Role } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { parseCsv } from "@/lib/csv";
import { addDays, asDate, validIso } from "@/lib/leave/dates";
import { creditOil } from "@/lib/leave/engine";
import { validateRules } from "@/lib/leave/rules";
import { sendMail } from "@/lib/notify";
import { prisma } from "@/lib/db";
import { blackoutMode, currentEmployee, loadState, patternOf, saveSeq, toActor } from "./store";

function hrOnly(role: string) {
  if (role !== "HR_ADMIN") redirect("/");
}

export async function creditOffInLieu(formData: FormData): Promise<{ error?: string }> {
  const me = await currentEmployee();
  hrOnly(me.role);
  const state = await loadState();
  const expires = String(formData.get("expires") || "");
  const result = creditOil(
    state,
    {
      employeeId: String(formData.get("employeeId") || ""),
      days: Number(formData.get("days") || 0),
      date: String(formData.get("date") || ""),
      reason: String(formData.get("reason") || ""),
      expiresOn: validIso(expires) ? expires : null,
    },
    toActor(me),
    new Date().toISOString(),
  );
  if (!result.ok) return { error: result.errors.join(" ") };
  const credit = result.state.credits[0];
  await prisma.oilCredit.create({
    data: {
      id: credit.id,
      employeeId: credit.employeeId,
      days: credit.days,
      workedOn: asDate(credit.date),
      reason: credit.reason,
      expiresOn: credit.expiresOn ? asDate(credit.expiresOn) : null,
      createdById: me.id,
    },
  });
  await saveSeq(result.state.seq);
  await writeAudit({
    actorId: me.id,
    actorName: me.name,
    action: "Credited off-in-lieu",
    entityType: "OilCredit",
    entityId: credit.id,
    after: credit,
  });
  const employee = state.employees.find((person) => person.id === credit.employeeId);
  if (employee) {
    await sendMail({
      to: employee.email,
      employeeId: employee.id,
      subject: "Off-in-lieu credited",
      text: `${credit.days} day(s) of off-in-lieu were credited for work on ${credit.date}. ${credit.reason}`,
    });
  }
  revalidatePath("/hr");
  redirect(`/hr?notice=${encodeURIComponent(`Credited ${credit.days} day(s) of off-in-lieu to ${employee?.name || "the employee"}.`)}`);
}

export async function addBlackout(formData: FormData): Promise<{ error?: string }> {
  const me = await currentEmployee();
  hrOnly(me.role);
  const start = String(formData.get("start") || "");
  const end = String(formData.get("end") || "");
  const label = String(formData.get("label") || "").trim();
  const scope = String(formData.get("scope") || "All");
  if (!validIso(start) || !validIso(end) || end < start || !label) return { error: "Enter a label and a valid date range." };
  const group = scope === "All" ? null : await prisma.orgGroup.findUnique({ where: { name: scope } });
  if (scope !== "All" && !group) return { error: "That team was not found." };
  const created = await prisma.blackout.create({
    data: {
      startDate: asDate(start),
      endDate: asDate(end),
      scopeAll: scope === "All",
      groupId: group?.id,
      mode: blackoutMode(String(formData.get("mode") || "Block")),
      label,
      createdById: me.id,
    },
  });
  await writeAudit({ actorId: me.id, actorName: me.name, action: "Added blackout", entityType: "Blackout", entityId: created.id, after: { label, start, end, scope } });
  revalidatePath("/hr");
  redirect(`/hr?notice=${encodeURIComponent(`Added blackout ${label}.`)}`);
}

export async function removeBlackout(formData: FormData): Promise<void> {
  const me = await currentEmployee();
  hrOnly(me.role);
  const id = String(formData.get("id") || "");
  const existing = await prisma.blackout.findUnique({ where: { id } });
  if (existing) {
    await prisma.blackout.delete({ where: { id } });
    await writeAudit({ actorId: me.id, actorName: me.name, action: "Removed blackout", entityType: "Blackout", entityId: id, before: { label: existing.label } });
  }
  revalidatePath("/hr");
  redirect("/hr?notice=Blackout%20removed.");
}

export async function saveCarryForward(formData: FormData): Promise<{ error?: string }> {
  const me = await currentEmployee();
  hrOnly(me.role);
  const cap = Number(formData.get("cap"));
  const expiry = String(formData.get("expiry") || "");
  if (!Number.isFinite(cap) || cap < 0 || cap > 14 || !validIso(expiry)) return { error: "Carry-forward cap must be from 0 to 14, with a use-by date." };
  const state = await loadState();
  const today = state.today;
  const groups = [...new Set(state.policies.filter((policy) => policy.status === "ACTIVE").map((policy) => policy.policyGroup))];
  for (const group of groups) {
    const current = [...state.policies].reverse().find((policy) => policy.policyGroup === group && policy.status === "ACTIVE" && policy.effectiveFrom <= today && (!policy.effectiveTo || policy.effectiveTo >= today));
    if (!current) continue;
    const rules = JSON.parse(JSON.stringify({ ...current.rules, carryForward: { cap: Math.floor(cap), expiry } }));
    const created = await prisma.policyVersion.create({
      data: {
        name: current.name + " carry-forward update",
        policyGroup: group,
        effectiveFrom: asDate(today),
        status: "ACTIVE",
        rules,
        changeNote: `Carry-forward cap ${Math.floor(cap)}, use by ${expiry}.`,
        createdById: me.id,
      },
    });
    await prisma.policyVersion.update({
      where: { id: current.id },
      data: { effectiveTo: asDate(addDays(today, -1)) },
    });
    await writeAudit({
      actorId: me.id,
      actorName: me.name,
      action: "Published policy version",
      entityType: "PolicyVersion",
      entityId: created.id,
      before: { id: current.id, carryForward: current.rules.carryForward },
      after: { carryForward: rules.carryForward, policyGroup: group },
    });
  }
  revalidatePath("/hr");
  redirect(`/hr?notice=${encodeURIComponent("Carry-forward rules were published as a new policy version for each active group.")}`);
}

export async function publishPolicy(formData: FormData): Promise<{ error?: string }> {
  const me = await currentEmployee();
  hrOnly(me.role);
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(formData.get("rules") || ""));
  } catch {
    return { error: "The rules are not valid JSON." };
  }
  const validated = validateRules(parsed);
  if (!validated.ok) return { error: validated.errors.join(" ") };
  const effectiveFrom = String(formData.get("effectiveFrom") || "");
  const policyGroup = String(formData.get("policyGroup") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const status = String(formData.get("status") || "DRAFT");
  const changeNote = String(formData.get("changeNote") || "").trim();
  if (!validIso(effectiveFrom) || !policyGroup || !name || !changeNote) return { error: "Name, group, effective date and a change note are required." };
  if (status !== "DRAFT" && status !== "ACTIVE") return { error: "Status must be draft or active." };
  const created = await prisma.policyVersion.create({
    data: {
      name,
      policyGroup,
      effectiveFrom: asDate(effectiveFrom),
      status,
      rules: JSON.parse(JSON.stringify(validated.rules)),
      changeNote,
      createdById: me.id,
    },
  });
  if (status === "ACTIVE") {
    const previous = await prisma.policyVersion.findMany({
      where: { policyGroup, status: "ACTIVE", id: { not: created.id }, effectiveFrom: { lt: asDate(effectiveFrom) } },
    });
    for (const policy of previous) {
      if (!policy.effectiveTo || policy.effectiveTo >= asDate(effectiveFrom)) {
        await prisma.policyVersion.update({ where: { id: policy.id }, data: { effectiveTo: asDate(addDays(effectiveFrom, -1)) } });
      }
    }
  }
  await writeAudit({
    actorId: me.id,
    actorName: me.name,
    action: "Published policy version",
    entityType: "PolicyVersion",
    entityId: created.id,
    after: { name, policyGroup, effectiveFrom, status, changeNote },
  });
  revalidatePath("/hr");
  redirect(`/hr?notice=${encodeURIComponent(`Saved policy “${name}” as ${status.toLowerCase()}.`)}`);
}

export async function activatePolicy(formData: FormData): Promise<void> {
  const me = await currentEmployee();
  hrOnly(me.role);
  const id = String(formData.get("id") || "");
  const policy = await prisma.policyVersion.findUnique({ where: { id } });
  if (!policy) redirect("/hr?notice=Policy%20was%20not%20found.");
  await prisma.policyVersion.update({ where: { id }, data: { status: "ACTIVE" } });
  const previous = await prisma.policyVersion.findMany({
    where: { policyGroup: policy.policyGroup, status: "ACTIVE", id: { not: id }, effectiveFrom: { lt: policy.effectiveFrom } },
  });
  const starts = policy.effectiveFrom.toISOString().slice(0, 10);
  for (const row of previous) {
    if (!row.effectiveTo || row.effectiveTo >= policy.effectiveFrom) {
      await prisma.policyVersion.update({
        where: { id: row.id },
        data: { effectiveTo: asDate(addDays(starts, -1)) },
      });
    }
  }
  await writeAudit({ actorId: me.id, actorName: me.name, action: "Activated policy", entityType: "PolicyVersion", entityId: id, after: { status: "ACTIVE" } });
  revalidatePath("/hr");
  redirect("/hr?notice=Policy%20activated.");
}

export async function addHoliday(formData: FormData): Promise<{ error?: string }> {
  const me = await currentEmployee();
  hrOnly(me.role);
  const date = String(formData.get("date") || "");
  const name = String(formData.get("name") || "").trim();
  if (!validIso(date) || !name) return { error: "Enter the holiday date and name." };
  await prisma.publicHoliday.upsert({
    where: { date: asDate(date) },
    update: { name, observed: formData.get("observed") === "yes" },
    create: { date: asDate(date), name, observed: formData.get("observed") === "yes" },
  });
  await writeAudit({ actorId: me.id, actorName: me.name, action: "Saved public holiday", entityType: "PublicHoliday", entityId: date, after: { name } });
  revalidatePath("/hr");
  redirect(`/hr?notice=${encodeURIComponent(`Saved ${name}.`)}`);
}

export async function saveDelegation(formData: FormData): Promise<{ error?: string }> {
  const me = await currentEmployee();
  const toId = String(formData.get("toId") || "");
  const start = String(formData.get("start") || "");
  const end = String(formData.get("end") || "");
  if (toId === me.id) return { error: "Choose someone else as your backup." };
  if (!validIso(start) || !validIso(end) || end < start) return { error: "Enter a valid backup period." };
  const delegate = await prisma.employee.findUnique({ where: { id: toId } });
  if (!delegate?.active) return { error: "That backup approver was not found." };
  const created = await prisma.delegation.create({
    data: { fromId: me.id, toId, startDate: asDate(start), endDate: asDate(end) },
  });
  await writeAudit({ actorId: me.id, actorName: me.name, action: "Named backup approver", entityType: "Delegation", entityId: created.id, after: { toId, start, end } });
  revalidatePath("/approvals");
  redirect(`/approvals?notice=${encodeURIComponent(`${delegate.name} can approve for you from ${start} to ${end}.`)}`);
}

export async function removeDelegation(formData: FormData): Promise<void> {
  const me = await currentEmployee();
  const id = String(formData.get("id") || "");
  const row = await prisma.delegation.findUnique({ where: { id } });
  if (row && (row.fromId === me.id || me.role === "HR_ADMIN")) {
    await prisma.delegation.delete({ where: { id } });
    await writeAudit({ actorId: me.id, actorName: me.name, action: "Removed backup approver", entityType: "Delegation", entityId: id });
  }
  revalidatePath("/approvals");
  redirect("/approvals");
}

const ROLES = new Set(["EMPLOYEE", "MANAGER", "HR_ADMIN"]);
const CATEGORIES = new Set(["SHORE", "CREW"]);

export async function importEmployees(formData: FormData): Promise<{ error?: string }> {
  const me = await currentEmployee();
  hrOnly(me.role);
  const file = formData.get("file");
  const pasted = String(formData.get("csv") || "");
  const text = file instanceof File && file.size ? await file.text() : pasted;
  if (!text.trim()) return { error: "Choose a CSV file or paste rows." };
  const rows = parseCsv(text);
  if (rows.length < 2) return { error: "The CSV needs a header and at least one employee." };
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const index = (name: string) => header.indexOf(name);
  const required = ["employee_id", "email", "name", "group", "joined_on"];
  for (const column of required) if (index(column) < 0) return { error: `Missing column ${column}.` };
  let created = 0;
  let updated = 0;
  const errors: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const cell = (name: string) => (index(name) >= 0 ? (row[index(name)] || "").trim() : "");
    const id = cell("employee_id");
    const email = cell("email").toLowerCase();
    const name = cell("name");
    const groupName = cell("group");
    const joined = cell("joined_on");
    if (!id || !email || !name || !groupName || !validIso(joined)) {
      errors.push(`Row ${i + 1} is missing an id, email, name, group or join date.`);
      continue;
    }
    const role = (ROLES.has(cell("role")) ? cell("role") : "EMPLOYEE") as Role;
    const category = (CATEGORIES.has(cell("category")) ? cell("category") : "SHORE") as Category;
    const pattern = patternOf(cell("work_pattern") || (category === "CREW" ? "SIX_DAY" : "FIVE_DAY"));
    const covered = cell("employment_act_covered").toLowerCase() !== "false" && category !== "CREW";
    const policyGroup = cell("policy_group") || (category === "CREW" ? "CREW" : "SHORE");
    const group = await prisma.orgGroup.upsert({
      where: { name: groupName },
      update: {},
      create: { name: groupName, kind: category === "CREW" ? "VESSEL" : "OFFICE" },
    });
    const approverId = cell("approver_id") || null;
    const password = cell("password");
    const data = {
      email,
      name,
      shortName: cell("short_name") || name.split(" ")[0],
      title: cell("title") || "Employee",
      role,
      category,
      employmentActCovered: covered,
      policyGroup,
      workPattern: pattern,
      joinedOn: asDate(joined),
      approverId: approverId && approverId !== id ? approverId : null,
      groupId: group.id,
      active: cell("active").toLowerCase() !== "false",
      ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
    };
    const existing = await prisma.employee.findUnique({ where: { id } });
    if (existing) {
      await prisma.employee.update({ where: { id }, data });
      updated += 1;
    } else {
      await prisma.employee.create({ data: { id, ...data } });
      created += 1;
    }
    const childDob = cell("child_dob");
    if (validIso(childDob)) {
      const already = await prisma.child.findFirst({ where: { employeeId: id, dateOfBirth: asDate(childDob) } });
      if (!already) {
        await prisma.child.create({
          data: {
            employeeId: id,
            name: cell("child_name") || "Child",
            dateOfBirth: asDate(childDob),
            singaporeCitizen: cell("child_citizen").toLowerCase() !== "false",
          },
        });
      }
    }
    const carry = cell("al_carry_days");
    const carryYear = Number(cell("al_carry_year") || "2026");
    if (carry !== "") {
      await prisma.openingBalance.upsert({
        where: { employeeId_year_leaveType: { employeeId: id, year: carryYear, leaveType: "AL" } },
        update: { carriedDays: Number(carry) },
        create: { employeeId: id, year: carryYear, leaveType: "AL", carriedDays: Number(carry), note: "Imported opening balance" },
      });
    }
  }
  await writeAudit({
    actorId: me.id,
    actorName: me.name,
    action: "Imported employees",
    entityType: "Employee",
    entityId: "import",
    after: { created, updated, errors },
  });
  revalidatePath("/hr");
  const summary = `Imported ${created} new and updated ${updated}.` + (errors.length ? " " + errors.slice(0, 3).join(" ") : "");
  redirect(`/hr?notice=${encodeURIComponent(summary)}`);
}

export async function updateEmployee(formData: FormData): Promise<{ error?: string }> {
  const me = await currentEmployee();
  hrOnly(me.role);
  const id = String(formData.get("id") || "");
  const existing = await prisma.employee.findUnique({ where: { id } });
  if (!existing) return { error: "Employee was not found." };
  const role = String(formData.get("role") || "EMPLOYEE");
  const category = String(formData.get("category") || "SHORE");
  if (!ROLES.has(role) || !CATEGORIES.has(category)) return { error: "Role or category is not valid." };
  const groupName = String(formData.get("group") || "").trim();
  const group = await prisma.orgGroup.upsert({
    where: { name: groupName },
    update: {},
    create: { name: groupName, kind: category === "CREW" ? "VESSEL" : "OFFICE" },
  });
  const approverId = String(formData.get("approverId") || "") || null;
  const second = String(formData.get("secondApproverId") || "") || null;
  const password = String(formData.get("password") || "");
  const before = { role: existing.role, approverId: existing.approverId, title: existing.title, policyGroup: existing.policyGroup };
  await prisma.employee.update({
    where: { id },
    data: {
      name: String(formData.get("name") || existing.name),
      shortName: String(formData.get("shortName") || existing.shortName),
      title: String(formData.get("title") || existing.title),
      email: String(formData.get("email") || existing.email).toLowerCase(),
      role: role as Role,
      category: category as Category,
      employmentActCovered: formData.get("employmentActCovered") === "yes",
      policyGroup: String(formData.get("policyGroup") || existing.policyGroup),
      workPattern: patternOf(String(formData.get("workPattern") || existing.workPattern)),
      joinedOn: asDate(String(formData.get("joined") || existing.joinedOn.toISOString().slice(0, 10))),
      approverId: approverId === id ? null : approverId,
      secondApproverId: second === id ? null : second,
      groupId: group.id,
      active: formData.get("active") === "yes",
      ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
    },
  });
  const childDob = String(formData.get("childDob") || "");
  if (validIso(childDob)) {
    await prisma.child.create({
      data: {
        employeeId: id,
        name: String(formData.get("childName") || "Child"),
        dateOfBirth: asDate(childDob),
        singaporeCitizen: formData.get("childCitizen") === "yes",
      },
    });
  }
  await writeAudit({ actorId: me.id, actorName: me.name, action: "Updated employee", entityType: "Employee", entityId: id, before, after: { role, approverId, title: String(formData.get("title") || "") } });
  revalidatePath("/hr");
  redirect(`/hr/employees/${id}?notice=${encodeURIComponent("Employee saved.")}`);
}
