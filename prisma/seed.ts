import bcrypt from "bcryptjs";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { asDate } from "../src/lib/leave/dates";
import { addDays } from "../src/lib/leave/dates";
import { buildSeedState, DEMO_PASSWORD } from "../src/lib/leave/seed-data";

const prisma = new PrismaClient();

const SAMPLE_PDF = Buffer.from(
  `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 320 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 88>>stream
BT /F1 12 Tf 36 70 Td (Fictional medical certificate for the GMT leave demo.) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`,
  "utf8",
);

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.SEED_RESET !== "true") {
    throw new Error("Refusing to reset production data. Set SEED_RESET=true if this is a deliberate demo reset.");
  }
  const state = buildSeedState();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  await prisma.$transaction([
    prisma.leaveTrail.deleteMany(),
    prisma.approvalStep.deleteMany(),
    prisma.document.deleteMany(),
    prisma.leaveRequest.deleteMany(),
    prisma.oilCredit.deleteMany(),
    prisma.openingBalance.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.delegation.deleteMany(),
    prisma.blackout.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.child.deleteMany(),
    prisma.employee.deleteMany(),
    prisma.policyVersion.deleteMany(),
    prisma.publicHoliday.deleteMany(),
    prisma.orgGroup.deleteMany(),
    prisma.counter.deleteMany(),
  ]);

  const groups = new Map<string, string>();
  for (const name of [...new Set(state.employees.map((person) => person.group))]) {
    const group = await prisma.orgGroup.create({
      data: { name, kind: name === "Shore office" ? "OFFICE" : "VESSEL" },
    });
    groups.set(name, group.id);
  }

  for (const policy of state.policies) {
    await prisma.policyVersion.create({
      data: {
        id: policy.id,
        name: policy.name,
        policyGroup: policy.policyGroup,
        effectiveFrom: asDate(policy.effectiveFrom),
        effectiveTo: policy.effectiveTo ? asDate(policy.effectiveTo) : null,
        status: policy.status,
        rules: JSON.parse(JSON.stringify(policy.rules)),
        changeNote: policy.changeNote,
      },
    });
  }

  for (const person of state.employees) {
    await prisma.employee.create({
      data: {
        id: person.id,
        email: person.email,
        passwordHash,
        name: person.name,
        shortName: person.shortName,
        title: person.title,
        role: person.role,
        category: person.category,
        employmentActCovered: person.employmentActCovered,
        policyGroup: person.policyGroup,
        workPattern: person.workPattern,
        joinedOn: asDate(person.joined),
        groupId: groups.get(person.group)!,
        active: true,
      },
    });
  }
  for (const person of state.employees) {
    await prisma.employee.update({
      where: { id: person.id },
      data: { approverId: person.approverId, secondApproverId: person.secondApproverId },
    });
    for (const child of person.children) {
      await prisma.child.create({
        data: { employeeId: person.id, name: child.name, dateOfBirth: asDate(child.dateOfBirth), singaporeCitizen: child.citizen },
      });
    }
  }

  for (const [date, name] of Object.entries(state.holidays)) {
    await prisma.publicHoliday.create({ data: { date: asDate(date), name, observed: name.toLowerCase().includes("observed") } });
  }
  for (const row of state.openingCarry) {
    await prisma.openingBalance.create({
      data: { employeeId: row.employeeId, year: row.year, leaveType: row.type, carriedDays: row.days, note: "Carried in from 2025" },
    });
  }
  for (const credit of state.credits) {
    await prisma.oilCredit.create({
      data: { id: credit.id, employeeId: credit.employeeId, days: credit.days, workedOn: asDate(credit.date), reason: credit.reason, createdById: "E11" },
    });
  }
  for (const blackout of state.blackouts) {
    await prisma.blackout.create({
      data: {
        id: blackout.id,
        startDate: asDate(blackout.start),
        endDate: asDate(blackout.end),
        scopeAll: blackout.scope === "All",
        groupId: blackout.scope === "All" ? null : groups.get(blackout.scope),
        mode: blackout.mode === "Block" ? "BLOCK" : "WARN",
        label: blackout.label,
        createdById: "E11",
      },
    });
  }

  const uploadRoot = process.env.UPLOAD_DIR || path.join(process.cwd(), "storage", "uploads");
  for (const request of state.requests) {
    await prisma.leaveRequest.create({
      data: {
        id: request.id,
        employeeId: request.employeeId,
        type: request.type,
        unit: request.unit === "full" ? "FULL" : request.unit === "am" ? "AM" : request.unit === "pm" ? "PM" : "HOURS",
        startDate: asDate(request.start),
        endDate: asDate(request.end),
        hours: request.hours,
        days: request.days,
        reason: request.reason,
        fileName: request.fileName,
        status: request.status === "Pending" ? "PENDING" : request.status === "Approved" ? "APPROVED" : request.status === "Rejected" ? "REJECTED" : "CANCELLED",
        pendingAction: "NONE",
        band: request.band,
        warnings: request.warnings,
        year: Number(request.start.slice(0, 4)),
        policyVersionId: request.policyId,
        submittedAt: new Date(request.trail[0]?.at || Date.now()),
        steps: { create: request.steps.map((step) => ({ level: step.level, approverId: step.approverId, status: step.status === "Pending" ? "PENDING" : step.status === "Approved" ? "APPROVED" : step.status === "Rejected" ? "REJECTED" : "WAITING" })) },
        trail: { create: request.trail.map((entry) => ({ at: new Date(entry.at), actorName: entry.by, action: entry.action, note: entry.note })) },
      },
    });
    if (request.fileName) {
      const key = `seed/${request.id}/certificate`;
      await mkdir(path.join(uploadRoot, "seed", request.id), { recursive: true });
      await writeFile(path.join(uploadRoot, key), SAMPLE_PDF);
      await prisma.document.create({
        data: {
          requestId: request.id,
          fileName: request.fileName,
          mimeType: request.fileName.endsWith(".pdf") ? "application/pdf" : "application/pdf",
          sizeBytes: SAMPLE_PDF.length,
          storageKey: key,
          kind: request.type === "SL" || request.type === "HL" ? "MC" : "OTHER",
          uploadedById: request.employeeId,
          retentionUntil: asDate(addDays(request.end, 730)),
        },
      });
    }
  }

  await prisma.counter.create({ data: { id: "request", value: state.seq } });
  await prisma.auditLog.create({
    data: { actorId: "E11", actorName: "Adeline Goh", action: "Seeded demo data", entityType: "Organisation", entityId: "gmt", after: { employees: state.employees.length, requests: state.requests.length } },
  });
  console.log(`Seeded ${state.employees.length} employees and ${state.requests.length} requests.`);
  console.log(`Demo password: ${DEMO_PASSWORD}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
