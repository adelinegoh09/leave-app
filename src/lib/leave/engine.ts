import {
  addDays,
  addMonths,
  ageOn,
  asOfDate,
  completedMonths,
  datesBetween,
  fmtD,
  monthName,
  nice,
  r2,
  roundHalfUp,
  toMs,
  validIso,
} from "./dates";
import type {
  Actor,
  AppState,
  Balance,
  BlackoutRecord,
  CheckResult,
  ChildRecord,
  CreditRecord,
  Draft,
  EmployeeRecord,
  Entitlement,
  FlowResult,
  LeaveType,
  PolicyRecord,
  PolicyRules,
  RequestRecord,
  ReqStatus,
  StepRecord,
  Unit,
  WorkPattern,
} from "./types";
import { typeInfo } from "./types";

const DAY = 86400000;

export function empOf(state: AppState, id: string): EmployeeRecord | undefined {
  return state.employees.find((e) => e.id === id);
}

export function approverName(state: AppState, id: string | null): string {
  if (!id) return "HR admin";
  return empOf(state, id)?.name || "Approver";
}

export function isPatternDay(iso: string, pattern: WorkPattern): boolean {
  const d = new Date(toMs(iso)).getUTCDay();
  if (d === 0) return false;
  if (d === 6 && pattern === "FIVE_DAY") return false;
  return true;
}

export function isWorkDay(iso: string, pattern: WorkPattern, holidays: Record<string, string>): boolean {
  return isPatternDay(iso, pattern) && holidays[iso] === undefined;
}

export function workDates(a: string, b: string, pattern: WorkPattern, holidays: Record<string, string>): string[] {
  return datesBetween(a, b).filter((d) => isWorkDay(d, pattern, holidays));
}

export function patternLabel(pattern: WorkPattern): string {
  return pattern === "SIX_DAY" ? "Monday to Saturday crew" : "Monday to Friday";
}

export function daysPerWeek(pattern: WorkPattern, cap = 6): number {
  return Math.min(pattern === "SIX_DAY" ? 6 : 5, cap);
}

export function selectPolicy(policies: PolicyRecord[], policyGroup: string, asOf: string): PolicyRecord | null {
  const matches = policies.filter(
    (p) =>
      p.status === "ACTIVE" &&
      p.policyGroup === policyGroup &&
      p.effectiveFrom <= asOf &&
      (p.effectiveTo == null || p.effectiveTo >= asOf),
  );
  matches.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0));
  return matches[0] ?? null;
}

export function policyFor(state: AppState, emp: EmployeeRecord, asOf: string): PolicyRecord | null {
  return selectPolicy(state.policies, emp.policyGroup, asOf);
}

function yearScoped(type: LeaveType): boolean {
  return type === "AL" || type === "SL" || type === "HL" || type === "CCL" || type === "NPL";
}

export function requestEnd(r: { unit: Unit; start: string; end: string }): string {
  return r.unit === "full" ? r.end : r.start;
}

export function requestDates(state: AppState, r: RequestRecord): string[] {
  const e = empOf(state, r.employeeId);
  if (!e) return [];
  if (r.type === "ML") return datesBetween(r.start, requestEnd(r));
  return r.unit === "full"
    ? workDates(r.start, r.end, e.workPattern, state.holidays)
    : isWorkDay(r.start, e.workPattern, state.holidays)
      ? [r.start]
      : [];
}

export function countDays(emp: EmployeeRecord, unit: Unit, start: string, end: string, hours: number, holidays: Record<string, string>, calendar = false): number {
  if (calendar) return datesBetween(start, unit === "full" ? end : start).length;
  if (unit === "full") return workDates(start, end, emp.workPattern, holidays).length;
  if (!isWorkDay(start, emp.workPattern, holidays)) return 0;
  if (unit === "hours") return r2(hours / 8);
  return 0.5;
}

export function serviceMonths(state: AppState, emp: EmployeeRecord, asOf: string, rules: PolicyRules): number {
  let m = completedMonths(emp.joined, asOf);
  const divisor = rules.annual.unpaidDaysPerServiceMonth;
  if (divisor > 0) {
    const unpaid = state.requests
      .filter((r) => r.employeeId === emp.id && r.type === "NPL" && r.status === "Approved" && r.end <= asOf)
      .reduce((sum, r) => sum + r.days, 0);
    m -= Math.floor(unpaid / divisor);
  }
  return Math.max(0, m);
}

function sickPair(months: number, rules: PolicyRules): [number, number] {
  let out = 0;
  let hosp = 0;
  const steps = [...rules.sick.steps].sort((a, b) => a.minMonths - b.minMonths);
  for (const step of steps) {
    if (months >= step.minMonths) {
      out = step.outpatient;
      hosp = step.hospitalisation;
    }
  }
  return [out, hosp];
}

function prorateGpcl(completed: number): number {
  if (completed < 3) return 0;
  if (completed <= 4) return 2;
  if (completed <= 6) return 3;
  if (completed <= 8) return 4;
  if (completed <= 10) return 5;
  return 6;
}

interface AgedChild {
  child: ChildRecord;
  age: number;
}

function agedChildren(emp: EmployeeRecord, on: string): AgedChild[] {
  return emp.children
    .filter((c) => validIso(c.dateOfBirth))
    .map((child) => ({ child, age: ageOn(child.dateOfBirth, on) }))
    .sort((a, b) => a.age - b.age);
}

function carryUseBy(rules: PolicyRules, year: number): string | null {
  const expiry = rules.carryForward.expiry;
  if (!validIso(expiry)) return null;
  return expiry.slice(0, 4) === String(year) ? expiry : null;
}

function openingCarryDays(state: AppState, empId: string, year: number): number | null {
  const row = state.openingCarry.find((o) => o.employeeId === empId && o.year === year && o.type === "AL");
  return row ? row.days : null;
}

function sumDays(state: AppState, id: string, type: LeaveType, year: number | null, statuses: ReqStatus[]): number {
  return r2(
    state.requests
      .filter((r) => {
        if (r.employeeId !== id || r.type !== type || !statuses.includes(r.status)) return false;
        if (year == null || !yearScoped(type)) return true;
        return Number(r.start.slice(0, 4)) === year;
      })
      .reduce((sum, r) => sum + r.days, 0),
  );
}

export function carryIn(state: AppState, emp: EmployeeRecord, year: number): { days: number; note: string } {
  const asOf = asOfDate(year, state.today);
  const policy = policyFor(state, emp, asOf);
  const cap = policy?.rules.carryForward.cap ?? 0;
  const expiry = policy?.rules.carryForward.expiry ?? "";
  const opening = openingCarryDays(state, emp.id, year);
  if (opening != null) {
    return { days: opening, note: opening ? fmtD(opening) + " carried in as an opening balance" : "" };
  }
  // Opening balances cover 2026. Earlier years are not reconstructed.
  if (year <= 2026) return { days: 0, note: "" };
  if (expiry && expiry < year + "-01-01") return { days: 0, note: "carry-forward expired" };
  const prev = balance(state, emp, "AL", year - 1);
  const unused = Math.max(0, (prev.ent.total || 0) - prev.taken);
  const days = Math.min(cap, unused);
  const useBy = expiry ? ", use by " + nice(expiry) : "";
  return { days, note: days ? fmtD(days) + " carried from " + (year - 1) + useBy : "" };
}

function annualBase(state: AppState, emp: EmployeeRecord, year: number, rules: PolicyRules): { days: number; note: string } {
  const asOf = asOfDate(year, state.today);
  const months = serviceMonths(state, emp, asOf, rules);
  if (months < rules.annual.minServiceMonths) {
    return { days: 0, note: "Eligible from " + nice(addMonths(emp.joined, rules.annual.minServiceMonths)) };
  }
  if (rules.annual.mode === "flat") {
    return { days: rules.annual.flatDays, note: "Contractual annual leave" };
  }
  const joinedYear = Number(emp.joined.slice(0, 4));
  if (rules.annual.proRateInJoinYear && joinedYear === year) {
    const mm = completedMonths(emp.joined, year + "-12-31");
    const days = roundHalfUp((rules.annual.baseDays * mm) / 12);
    return { days, note: rules.annual.baseDays + " days pro-rated for joining in " + year };
  }
  const yos = Math.floor(completedMonths(emp.joined, year + "-01-01") / 12) + 1;
  const days = Math.min(rules.annual.maxDays, rules.annual.baseDays + (yos - 1) * rules.annual.extraPerYear);
  return { days, note: "Year " + yos + " of service" };
}

function childcareEntitlement(state: AppState, emp: EmployeeRecord, year: number, rules: PolicyRules, on: string): Entitlement {
  if (!rules.childcare.enabled) return { total: 0, note: "Childcare leave is not in this policy", band: null, base: 0, carry: 0 };
  const months = serviceMonths(state, emp, on, rules);
  if (months < 3) return { total: 0, note: "Eligible after 3 months of service", band: null, base: 0, carry: 0 };
  const kids = agedChildren(emp, on);
  if (!kids.length) return { total: 0, note: "No child on record", band: null, base: 0, carry: 0 };
  const enhanced = rules.childcare.enhanced;
  if (enhanced?.inForce) {
    const pool = kids.filter((k) => k.age >= 0 && k.age <= enhanced.maxAge && (!enhanced.citizenOnly || k.child.citizen));
    if (pool.length) {
      const days = pool.length >= 3 ? enhanced.daysForThreeOrMore : pool.length === 2 ? enhanced.daysForTwo : enhanced.daysForOne;
      return {
        total: days,
        note: "Announced childcare scale, " + pool.length + " child" + (pool.length === 1 ? "" : "ren") + " aged " + enhanced.maxAge + " and under",
        band: "enhanced",
        base: days,
        carry: 0,
      };
    }
    if (!enhanced.keepNonCitizenFallback) {
      return { total: 0, note: "No child in the announced age range", band: null, base: 0, carry: 0 };
    }
  }
  const youngest = kids[0];
  const band = rules.childcare.bands.find(
    (b) => b.citizen === youngest.child.citizen && youngest.age >= b.minAge && youngest.age <= b.maxAge,
  );
  if (!band) return { total: 0, note: "Youngest child is over 12", band: null, base: 0, carry: 0 };
  let days = band.days;
  let note = band.label + ", child aged " + youngest.age;
  if (band.proRate && Number(emp.joined.slice(0, 4)) === year) {
    days = prorateGpcl(months);
    note += ", pro-rated for " + months + " completed months of service";
  }
  return { total: days, note, band: band.id, base: days, carry: 0 };
}

function birthContext(emp: EmployeeRecord, draft?: Draft): { dob: string; citizen: boolean } | null {
  if (draft?.childDateOfBirth && validIso(draft.childDateOfBirth)) {
    return { dob: draft.childDateOfBirth, citizen: Boolean(draft.childCitizen) };
  }
  const youngest = [...emp.children].sort((a, b) => (a.dateOfBirth < b.dateOfBirth ? 1 : -1))[0];
  if (!youngest) return null;
  return { dob: youngest.dateOfBirth, citizen: youngest.citizen };
}

function parentalEntitlement(state: AppState, emp: EmployeeRecord, type: LeaveType, rules: PolicyRules, on: string): Entitlement {
  const months = serviceMonths(state, emp, on, rules);
  const birth = birthContext(emp);
  if (type === "ML") {
    if (!rules.maternity.enabled) return { total: 0, note: "Maternity leave is not in this policy", band: null, base: 0, carry: 0 };
    if (months < rules.maternity.minServiceMonths) return { total: 0, note: "Eligible after 3 months of service", band: null, base: 0, carry: 0 };
    if (!birth) return { total: 0, note: "Add the child's date of birth on the application", band: "ml", base: 0, carry: 0 };
    const weeks = birth.citizen ? rules.maternity.citizenWeeks : rules.maternity.otherWeeks;
    const days = weeks * 7;
    return { total: days, note: weeks + " weeks" + (birth.citizen ? " (Singapore citizen child)" : " (child is not a Singapore citizen)"), band: "ml", base: days, carry: 0 };
  }
  if (type === "PL") {
    if (!rules.paternity.enabled) return { total: 0, note: "Paternity leave is not in this policy", band: null, base: 0, carry: 0 };
    if (months < rules.paternity.minServiceMonths) return { total: 0, note: "Eligible after 3 months of service", band: null, base: 0, carry: 0 };
    if (!birth) return { total: 0, note: "Add the child's date of birth on the application", band: "pl", base: 0, carry: 0 };
    if (birth.dob < rules.paternity.eligibleBirthOnOrAfter) {
      return { total: 0, note: "Government-paid paternity leave applies to births on or after " + nice(rules.paternity.eligibleBirthOnOrAfter), band: null, base: 0, carry: 0 };
    }
    const days = rules.paternity.weeks * daysPerWeek(emp.workPattern, rules.paternity.maxDaysPerWeek);
    return { total: days, note: rules.paternity.weeks + " weeks on a " + patternLabel(emp.workPattern) + " pattern, capped at " + rules.paternity.maxDaysPerWeek + " days a week", band: "pl", base: days, carry: 0 };
  }
  if (!rules.sharedParental.enabled) return { total: 0, note: "Shared parental leave is not in this policy", band: null, base: 0, carry: 0 };
  if (months < rules.sharedParental.minServiceMonths) return { total: 0, note: "Eligible after 3 months of service", band: null, base: 0, carry: 0 };
  if (!birth) return { total: 0, note: "Add the child's date of birth on the application", band: "spl", base: 0, carry: 0 };
  const tier = [...rules.sharedParental.tiers].reverse().find((t) => birth.dob >= t.birthFrom && (t.birthTo == null || birth.dob <= t.birthTo));
  if (!tier) return { total: 0, note: "No shared parental tier covers this child's date of birth", band: null, base: 0, carry: 0 };
  const days = tier.weeks * daysPerWeek(emp.workPattern, 6);
  return { total: days, note: tier.weeks + " shared weeks for a child born " + nice(birth.dob) + ". Record the allocation agreed with the other parent in the reason.", band: "spl", base: days, carry: 0 };
}

export function entitlement(state: AppState, emp: EmployeeRecord, type: LeaveType, year: number): Entitlement {
  const asOf = asOfDate(year, state.today);
  const policy = policyFor(state, emp, asOf);
  if (!policy) return { total: 0, note: "No leave policy is active for this date", band: null, base: 0, carry: 0 };
  const rules = policy.rules;
  if (type === "AL") {
    const base = annualBase(state, emp, year, rules);
    const carry = carryIn(state, emp, year);
    return {
      total: r2(base.days + carry.days),
      note: base.note + (carry.note ? ", plus " + carry.note : ""),
      band: null,
      base: base.days,
      carry: carry.days,
    };
  }
  if (type === "SL" || type === "HL") {
    const months = serviceMonths(state, emp, asOf, rules);
    const pair = sickPair(months, rules);
    if (type === "SL") {
      return {
        total: pair[0],
        note: pair[0] ? (pair[0] < 14 ? "Stepped up in the first 6 months" : "14 days outpatient") : "Eligible after 3 months of service",
        band: null,
        base: pair[0],
        carry: 0,
      };
    }
    return {
      total: pair[1],
      note: pair[1] ? "Includes outpatient sick leave" : "Eligible after 3 months of service",
      band: null,
      base: pair[1],
      carry: 0,
    };
  }
  if (type === "CCL") return childcareEntitlement(state, emp, year, rules, asOf);
  if (type === "OIL") {
    const days = r2(
      state.credits
        .filter((c) => c.employeeId === emp.id && (!c.expiresOn || c.expiresOn >= asOf))
        .reduce((sum, c) => sum + c.days, 0),
    );
    return { total: days, note: days ? "Credited by HR" : "Credited by HR", band: null, base: days, carry: 0 };
  }
  if (type === "NPL") return { total: null, note: "No cap, deducted from pay", band: null, base: null, carry: 0 };
  return parentalEntitlement(state, emp, type, rules, asOf);
}

function forfeitedCarry(state: AppState, emp: EmployeeRecord, year: number, on: string): number {
  const policy = policyFor(state, emp, asOfDate(year, state.today));
  if (!policy) return 0;
  const useBy = carryUseBy(policy.rules, year);
  if (!useBy || on <= useBy) return 0;
  const carry = carryIn(state, emp, year).days;
  const used = r2(
    state.requests
      .filter(
        (r) =>
          r.employeeId === emp.id &&
          r.type === "AL" &&
          (r.status === "Approved" || r.status === "Pending") &&
          Number(r.start.slice(0, 4)) === year &&
          r.start <= useBy,
      )
      .reduce((sum, r) => sum + r.days, 0),
  );
  return r2(Math.max(0, carry - used));
}

export function balance(state: AppState, emp: EmployeeRecord, type: LeaveType, year: number): Balance {
  const ent = entitlement(state, emp, type, year);
  const taken = sumDays(state, emp.id, type, yearScoped(type) ? year : null, ["Approved"]);
  const pending = sumDays(state, emp.id, type, yearScoped(type) ? year : null, ["Pending"]);
  if (type === "NPL") return { ent, taken, pending, avail: null };
  if (type === "SL" || type === "HL") {
    const hl = entitlement(state, emp, "HL", year).total || 0;
    const sl = entitlement(state, emp, "SL", year).total || 0;
    const both =
      sumDays(state, emp.id, "SL", year, ["Approved", "Pending"]) +
      sumDays(state, emp.id, "HL", year, ["Approved", "Pending"]);
    const capLeft = hl - both;
    const ownTaken = type === "HL" ? 0 : taken + pending;
    const avail = type === "HL" ? capLeft : Math.min(sl - ownTaken, capLeft);
    return { ent, taken, pending, avail: r2(Math.max(0, avail)) };
  }
  let avail = r2(Math.max(0, (ent.total || 0) - taken - pending));
  if (type === "AL") avail = r2(Math.max(0, avail - forfeitedCarry(state, emp, year, state.today)));
  if (type === "CCL" && ent.band && ent.band !== "enhanced") {
    const policy = policyFor(state, emp, asOfDate(year, state.today));
    const band = policy?.rules.childcare.bands.find((b) => b.id === ent.band);
    if (band?.lifetimeCap != null) {
      const used = state.requests
        .filter((r) => r.employeeId === emp.id && r.type === "CCL" && r.band === ent.band && (r.status === "Approved" || r.status === "Pending"))
        .reduce((sum, r) => sum + r.days, 0);
      const lifeLeft = Math.max(0, band.lifetimeCap - used);
      avail = r2(Math.min(avail, lifeLeft));
    }
  }
  return { ent, taken, pending, avail };
}

function activeCredits(state: AppState, empId: string, on: string): CreditRecord[] {
  return state.credits.filter((c) => c.employeeId === empId && (!c.expiresOn || c.expiresOn >= on));
}

export function checkDraft(state: AppState, draft: Draft): CheckResult {
  const emp = empOf(state, draft.employeeId);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!emp || !emp.active) return { days: 0, errors: ["Employee record was not found."], warnings, holidays: [], band: null };
  const person =
    draft.childDateOfBirth && validIso(draft.childDateOfBirth)
      ? {
          ...emp,
          children: emp.children.some((c) => c.dateOfBirth === draft.childDateOfBirth)
            ? emp.children
            : [...emp.children, { name: "Child", dateOfBirth: draft.childDateOfBirth, citizen: Boolean(draft.childCitizen) }],
        }
      : emp;
  const end = draft.unit === "full" ? draft.end : draft.start;
  if (!validIso(draft.start) || !validIso(end)) return { days: 0, errors: ["Pick the leave dates."], warnings, holidays: [], band: null };
  if (end < draft.start) errors.push("The end date is before the start date.");
  if (draft.start.slice(0, 4) !== end.slice(0, 4)) errors.push("Leave that runs into the new year goes in two applications, one per leave year.");
  const year = Number(draft.start.slice(0, 4));
  const holidayYear = Object.keys(state.holidays).some((d) => d.startsWith(String(year)));
  if (!holidayYear) warnings.push("Public holidays for " + year + " are not loaded yet, so working days may be overstated.");
  if (draft.start < state.today && draft.type !== "SL" && draft.type !== "HL" && !draft.backdateOverride) {
    errors.push("Only sick and hospitalisation leave can be backdated.");
  }
  if (draft.unit === "hours" && !(draft.hours >= 1 && draft.hours <= 7)) errors.push("Hours must be between 1 and 7.");
  if (draft.type === "HL" && draft.unit !== "full") errors.push("Hospitalisation leave is taken in full days.");
  if ((draft.type === "ML" || draft.type === "PL" || draft.type === "SPL") && draft.unit !== "full") {
    errors.push("Parental leave is taken in full days.");
  }
  const holidaysHit = errors.length
    ? []
    : datesBetween(draft.start, end)
        .filter((d) => state.holidays[d] !== undefined && isPatternDay(d, emp.workPattern))
        .map((d) => nice(d) + " " + state.holidays[d]);
  const calendar = draft.type === "ML";
  const days = errors.length ? 0 : countDays(emp, draft.unit, draft.start, end, draft.hours, state.holidays, calendar);
  if (!errors.length && days === 0) errors.push("There are no working days in this period for this employee's work pattern.");
  if (errors.length) return { days, errors, warnings, holidays: holidaysHit, band: null };

  const policy = policyFor(state, person, draft.start);
  if (!policy) errors.push("No leave policy is active on " + nice(draft.start) + ".");
  const rules = policy?.rules;
  const bal = balance(state, person, draft.type, year);
  let band = bal.ent.band;

  if (draft.type === "OIL" && activeCredits(state, emp.id, draft.start).length === 0 && (bal.ent.total || 0) === 0) {
    errors.push("No off-in-lieu has been credited yet. HR credits it after rest-day or holiday work.");
  } else if (draft.type !== "NPL" && (bal.ent.total || 0) === 0) {
    errors.push("Not eligible for " + typeInfo(draft.type).label.toLowerCase() + " yet. " + bal.ent.note + ".");
  } else if (draft.type === "AL" && rules) {
    const useBy = carryUseBy(rules, year);
    let avail = bal.avail || 0;
    if (useBy && draft.start > useBy && state.today <= useBy) {
      const projected = balance({ ...state, today: addDays(useBy, 1) }, person, "AL", year);
      const nextAvail = projected.avail || 0;
      const dropped = r2(Math.max(0, avail - nextAvail));
      avail = nextAvail;
      if (dropped > 0) warnings.push(fmtD(dropped) + " carried day(s) must be used by " + nice(useBy) + " and do not cover this date.");
    }
    if (days > avail) errors.push("Not enough annual leave: " + fmtD(avail) + " day(s) left after pending requests, and this needs " + fmtD(days) + ".");
  } else if (bal.avail !== null && days > bal.avail) {
    errors.push("Not enough " + typeInfo(draft.type).label.toLowerCase() + ": " + fmtD(bal.avail) + " day(s) left after pending requests, and this needs " + fmtD(days) + ".");
  }

  if ((draft.type === "SL" || draft.type === "HL") && rules?.sick.mcRequired && !draft.hasFile) {
    errors.push("Attach the MC or hospital document.");
  }
  if (draft.type === "NPL" && !draft.reason.trim()) errors.push("Give a reason for unpaid leave.");
  if ((draft.type === "ML" || draft.type === "PL" || draft.type === "SPL") && !birthContext(person, draft)) {
    errors.push("Add the child's date of birth. HR can also record the child on the employee profile.");
  }

  const clash = state.requests.find(
    (r) =>
      r.employeeId === emp.id &&
      (r.status === "Pending" || r.status === "Approved") &&
      r.start <= end &&
      requestEnd(r) >= draft.start,
  );
  if (clash) errors.push("You already have " + typeInfo(clash.type).label.toLowerCase() + " on " + dateLabel(clash) + ".");

  if (draft.type === "AL" || draft.type === "OIL" || draft.type === "NPL") {
    state.blackouts
      .filter((b) => (b.scope === "All" || b.scope === emp.group) && b.start <= end && b.end >= draft.start)
      .forEach((b) => {
        const where = b.label + ", " + nice(b.start) + " to " + nice(b.end) + " (" + (b.scope === "All" ? "everyone" : b.scope) + ")";
        if (b.mode === "Block" && !draft.blackoutOverride) errors.push("Blackout period: " + where + ". Ask HR for an override.");
        else if (b.mode === "Block" && draft.blackoutOverride) warnings.push("Blackout overridden by HR: " + where + ".");
        else warnings.push("Falls in a blackout period: " + where + ". Your approver will see this warning.");
      });
  }
  if (draft.blackoutOverride && !draft.overrideReason?.trim()) errors.push("Give a reason for the blackout override.");

  if (draft.type === "SL" && rules && toMs(draft.start) < toMs(state.today) - 2 * DAY) {
    warnings.push("Submitted more than 48 hours after the first day of sick leave. HR may ask for the reason.");
  }
  if (draft.type === "NPL") warnings.push(fmtD(days) + " unpaid day(s) will go to payroll for " + monthName(draft.start.slice(0, 7)) + ".");

  if (rules && (draft.type === "ML" || draft.type === "PL" || draft.type === "SPL")) {
    const birth = birthContext(person, draft);
    if (birth && draft.type === "ML") {
      const notice = addDays(state.today, rules.maternity.noticeWeeks * 7);
      if (draft.start < notice) warnings.push("Maternity leave is normally applied with " + rules.maternity.noticeWeeks + " weeks' notice.");
    }
    if (birth && draft.type === "PL") {
      const window = addDays(birth.dob, rules.paternity.continuousWithinWeeks * 7);
      const limit = addMonths(birth.dob, rules.paternity.splitWithinMonths);
      if (draft.start > limit) errors.push("Paternity leave must start within " + rules.paternity.splitWithinMonths + " months of the birth (" + nice(birth.dob) + ").");
      else if (draft.start > window) warnings.push("This is outside the default " + rules.paternity.continuousWithinWeeks + "-week block. Split paternity leave needs agreement.");
    }
    if (birth && draft.type === "SPL") {
      const limit = addMonths(birth.dob, rules.sharedParental.withinMonths);
      if (draft.start > limit) errors.push("Shared parental leave must be taken within " + rules.sharedParental.withinMonths + " months of the birth.");
      const notice = addDays(state.today, rules.sharedParental.noticeWeeks * 7);
      if (draft.start < notice) warnings.push("Shared parental leave is normally applied with " + rules.sharedParental.noticeWeeks + " weeks' notice.");
    }
  }

  if (draft.type === "CCL" && band && band !== "enhanced") {
    const bandRule = rules?.childcare.bands.find((b) => b.id === band);
    if (bandRule?.lifetimeCap != null) {
      const used = state.requests
        .filter((r) => r.employeeId === emp.id && r.type === "CCL" && r.band === band && (r.status === "Approved" || r.status === "Pending"))
        .reduce((sum, r) => sum + r.days, 0);
      if (used + days > bandRule.lifetimeCap) {
        errors.push("This would pass the " + bandRule.lifetimeCap + "-day cap for this child (" + fmtD(bandRule.lifetimeCap - used) + " left).");
      }
    }
  }

  return { days, errors, warnings, holidays: holidaysHit, band };
}

export function unitLabel(r: { unit: Unit; hours: number }): string {
  if (r.unit === "full") return "Full day";
  if (r.unit === "am") return "Half day (AM)";
  if (r.unit === "pm") return "Half day (PM)";
  return r.hours + " hours";
}

export function dateLabel(r: { unit: Unit; start: string; end: string; hours: number }): string {
  if (r.unit === "full") return r.start === r.end ? nice(r.start) : nice(r.start) + " to " + nice(r.end);
  return nice(r.start) + ", " + unitLabel(r).toLowerCase();
}

export function trailText(r: RequestRecord): string {
  return r.trail.map((t) => t.action + " by " + t.by + ", " + t.at + (t.note ? " (" + t.note + ")" : "")).join("; ");
}

function nextId(state: AppState, prefix: string): { id: string; state: AppState } {
  const id = prefix + state.seq;
  return { id, state: { ...state, seq: state.seq + 1 } };
}

export function submitApplication(state: AppState, draft: Draft, actor: Actor, at: string): FlowResult {
  const emp = empOf(state, draft.employeeId);
  if (!emp) return { ok: false, errors: ["Employee record was not found."] };
  if (actor.role !== "HR_ADMIN" && actor.id !== emp.id) return { ok: false, errors: ["You can only apply for your own leave."] };
  if ((draft.blackoutOverride || draft.backdateOverride) && actor.role !== "HR_ADMIN") {
    return { ok: false, errors: ["Only HR can override a blackout or a backdated application."] };
  }
  const check = checkDraft(state, draft);
  if (check.errors.length) return { ok: false, errors: check.errors };
  if (emp.approverId === emp.id || emp.secondApproverId === emp.id) {
    return { ok: false, errors: ["The approver cannot be the applicant. Ask HR to set someone else."] };
  }
  const steps: StepRecord[] = [{ level: 1, approverId: emp.approverId, status: "Pending" }];
  if (emp.secondApproverId) steps.push({ level: 2, approverId: emp.secondApproverId, status: "Waiting" });
  const issued = nextId(state, "L");
  const request: RequestRecord = {
    id: issued.id,
    employeeId: emp.id,
    type: draft.type,
    unit: draft.unit,
    start: draft.start,
    end: draft.unit === "full" ? draft.end : draft.start,
    hours: draft.unit === "hours" ? draft.hours : 0,
    days: check.days,
    reason: draft.reason.trim(),
    fileName: draft.fileName || "",
    status: "Pending",
    pendingAction: "NONE",
    band: check.band,
    warnings: check.warnings,
    steps,
    trail: [{ at, by: actor.name, action: actor.id === emp.id ? "Submitted" : "Submitted for employee", note: draft.reason.trim() }],
    policyId: policyFor(state, emp, draft.start)?.id ?? null,
  };
  return { ok: true, state: { ...issued.state, requests: [request, ...issued.state.requests] }, request };
}

export function actorCanDecide(state: AppState, request: RequestRecord, actor: Actor): boolean {
  if (request.employeeId === actor.id) return false;
  if (request.pendingAction === "CANCEL" && request.status === "Approved") {
    const approverId = request.steps[0]?.approverId ?? null;
    return approverMatches(state, approverId, actor);
  }
  const step = request.steps.find((s) => s.status === "Pending");
  if (!step || request.status !== "Pending") return false;
  return approverMatches(state, step.approverId, actor);
}

function approverMatches(state: AppState, approverId: string | null, actor: Actor): boolean {
  if (approverId == null) return actor.role === "HR_ADMIN";
  if (approverId === actor.id) return true;
  return state.delegations.some((d) => d.fromId === approverId && d.toId === actor.id && d.start <= state.today && d.end >= state.today);
}

export function queueFor(state: AppState, actor: Actor): RequestRecord[] {
  return state.requests
    .filter((r) => {
      const open = r.status === "Pending" || (r.status === "Approved" && r.pendingAction === "CANCEL");
      return open && actorCanDecide(state, r, actor);
    })
    .sort((a, b) => (a.start < b.start ? -1 : 1));
}

export function decideApplication(state: AppState, id: string, approve: boolean, actor: Actor, note: string, at: string): FlowResult {
  const request = state.requests.find((r) => r.id === id);
  if (!request) return { ok: false, errors: ["Request was not found."] };
  if (!actorCanDecide(state, request, actor)) return { ok: false, errors: ["You cannot decide this request."] };
  if (!approve && !note.trim() && request.pendingAction !== "CANCEL") {
    return { ok: false, errors: ["Add a comment to say why before rejecting " + (empOf(state, request.employeeId)?.name || "this") + "'s request."] };
  }
  let next: RequestRecord;
  if (request.pendingAction === "CANCEL") {
    next = approve
      ? { ...request, status: "Cancelled", pendingAction: "NONE", trail: [...request.trail, { at, by: actor.name, action: "Cancellation approved", note: note.trim() }] }
      : { ...request, pendingAction: "NONE", trail: [...request.trail, { at, by: actor.name, action: "Cancellation declined", note: note.trim() }] };
  } else if (!approve) {
    next = {
      ...request,
      status: "Rejected",
      steps: request.steps.map((s) => (s.status === "Pending" ? { ...s, status: "Rejected" } : s)),
      trail: [...request.trail, { at, by: actor.name, action: "Rejected", note: note.trim() }],
    };
  } else {
    const steps = request.steps.map((s) => ({ ...s }));
    const current = steps.find((s) => s.status === "Pending");
    if (current) current.status = "Approved";
    const waiting = steps.find((s) => s.status === "Waiting");
    if (waiting) {
      waiting.status = "Pending";
      next = {
        ...request,
        steps,
        trail: [...request.trail, { at, by: actor.name, action: "Approved level " + (current?.level || 1), note: note.trim() }],
      };
    } else {
      next = {
        ...request,
        status: "Approved",
        steps,
        trail: [...request.trail, { at, by: actor.name, action: "Approved", note: note.trim() }],
      };
    }
  }
  return { ok: true, state: { ...state, requests: state.requests.map((r) => (r.id === id ? next : r)) }, request: next };
}

export function cancelApplication(state: AppState, id: string, actor: Actor, at: string): FlowResult {
  const request = state.requests.find((r) => r.id === id);
  if (!request) return { ok: false, errors: ["Request was not found."] };
  const owner = request.employeeId === actor.id;
  if (!owner && actor.role !== "HR_ADMIN") return { ok: false, errors: ["You can only cancel your own request."] };
  if (request.status === "Pending" && request.pendingAction === "NONE") {
    const next: RequestRecord = {
      ...request,
      status: "Cancelled",
      trail: [...request.trail, { at, by: actor.name, action: "Cancelled", note: "" }],
    };
    return { ok: true, state: { ...state, requests: state.requests.map((r) => (r.id === id ? next : r)) }, request: next };
  }
  if (request.status === "Approved" && request.start >= state.today && request.pendingAction === "NONE") {
    const next: RequestRecord = {
      ...request,
      pendingAction: "CANCEL",
      trail: [...request.trail, { at, by: actor.name, action: "Cancellation requested", note: "" }],
    };
    return { ok: true, state: { ...state, requests: state.requests.map((r) => (r.id === id ? next : r)) }, request: next };
  }
  return { ok: false, errors: ["This request can no longer be cancelled."] };
}

export function amendApplication(state: AppState, id: string, draft: Draft, actor: Actor, at: string): FlowResult {
  const existing = state.requests.find((r) => r.id === id);
  if (!existing) return { ok: false, errors: ["Request was not found."] };
  if (existing.employeeId !== actor.id && actor.role !== "HR_ADMIN") return { ok: false, errors: ["You can only amend your own request."] };
  if (existing.status !== "Pending" || existing.steps.some((s) => s.status === "Approved")) {
    return { ok: false, errors: ["Approved leave cannot be edited in place. Request a cancellation, then apply again."] };
  }
  const without = { ...state, requests: state.requests.filter((r) => r.id !== id) };
  const check = checkDraft(without, { ...draft, employeeId: existing.employeeId });
  if (check.errors.length) return { ok: false, errors: check.errors };
  const next: RequestRecord = {
    ...existing,
    type: draft.type,
    unit: draft.unit,
    start: draft.start,
    end: draft.unit === "full" ? draft.end : draft.start,
    hours: draft.unit === "hours" ? draft.hours : 0,
    days: check.days,
    reason: draft.reason.trim(),
    fileName: draft.fileName || existing.fileName,
    band: check.band,
    warnings: check.warnings,
    policyId: policyFor(without, empOf(state, existing.employeeId) as EmployeeRecord, draft.start)?.id ?? existing.policyId,
    trail: [...existing.trail, { at, by: actor.name, action: "Amended", note: draft.reason.trim() }],
  };
  return { ok: true, state: { ...state, requests: state.requests.map((r) => (r.id === id ? next : r)) }, request: next };
}

export function creditOil(state: AppState, input: { employeeId: string; days: number; date: string; reason: string; expiresOn: string | null }, actor: Actor, at: string): FlowResult {
  if (actor.role !== "HR_ADMIN") return { ok: false, errors: ["Only HR can credit off-in-lieu."] };
  const emp = empOf(state, input.employeeId);
  if (!emp) return { ok: false, errors: ["Employee was not found."] };
  if (!input.reason.trim() || !validIso(input.date) || !(input.days > 0)) return { ok: false, errors: ["Enter the days, the date worked and a reason."] };
  const issued = nextId(state, "C");
  const credit: CreditRecord = { id: issued.id, employeeId: emp.id, days: input.days, date: input.date, reason: input.reason.trim(), expiresOn: input.expiresOn };
  const dummy: RequestRecord = {
    id: issued.id,
    employeeId: emp.id,
    type: "OIL",
    unit: "full",
    start: input.date,
    end: input.date,
    hours: 0,
    days: input.days,
    reason: input.reason.trim(),
    fileName: "",
    status: "Approved",
    pendingAction: "NONE",
    band: null,
    warnings: [],
    steps: [],
    trail: [{ at, by: actor.name, action: "Off-in-lieu credited", note: input.reason.trim() }],
    policyId: null,
  };
  return { ok: true, state: { ...issued.state, credits: [credit, ...issued.state.credits] }, request: dummy };
}

export function isOverdue(state: AppState, request: RequestRecord): boolean {
  if (request.status !== "Pending") return false;
  const emp = empOf(state, request.employeeId);
  const policy = emp ? policyFor(state, emp, request.start) : null;
  const hours = policy?.rules.escalationHours ?? 24;
  const submitted = request.trail[0]?.at;
  if (!submitted) return false;
  const submittedMs = Date.parse(submitted);
  if (Number.isNaN(submittedMs)) return false;
  const todayMs = toMs(state.today) + 12 * 60 * 60 * 1000;
  return todayMs - submittedMs > hours * 60 * 60 * 1000;
}

export function calendarEvents(state: AppState, month: string, group: string): { date: string; title: string; kind: "holiday" | "leave" }[] {
  const out: { date: string; title: string; kind: "holiday" | "leave" }[] = [];
  Object.keys(state.holidays)
    .filter((d) => d.startsWith(month))
    .forEach((d) => out.push({ date: d, title: state.holidays[d], kind: "holiday" }));
  state.requests
    .filter((r) => (r.status === "Approved" || r.status === "Pending") && (group === "All" || empOf(state, r.employeeId)?.group === group))
    .forEach((r) => {
      const person = empOf(state, r.employeeId);
      requestDates(state, r)
        .filter((d) => d.startsWith(month))
        .forEach((d) =>
          out.push({
            date: d,
            title: (person?.shortName || "Staff") + ", " + typeInfo(r.type).short + (r.status === "Pending" ? " (pending)" : ""),
            kind: "leave",
          }),
        );
    });
  return out;
}

export const PAY_HEAD = ["Employee ID", "Name", "Group", "Leave type", "Start", "End", "Duration", "Days in period", "Unpaid days", "Approved by", "Approved on"];

export function payrollRows(state: AppState, month: string): string[][] {
  const rows: string[][] = [];
  const sorted = [...state.requests].filter((r) => r.status === "Approved").sort((a, b) => (a.start < b.start ? -1 : 1));
  for (const r of sorted) {
    const e = empOf(state, r.employeeId);
    if (!e) continue;
    const dates = requestDates(state, r).filter((d) => month === "All" || d.startsWith(month));
    if (!dates.length && !(month !== "All" && r.type === "ML" && r.start.slice(0, 7) <= month && requestEnd(r).slice(0, 7) >= month)) continue;
    const inPeriod = r.unit === "full" ? (r.type === "ML" ? datesBetween(r.start, requestEnd(r)).filter((d) => month === "All" || d.startsWith(month)).length : dates.length) : r.days;
    if (!inPeriod) continue;
    const approved = [...r.trail].reverse().find((t) => t.action === "Approved" || t.action.startsWith("Approved level"));
    rows.push([
      e.id,
      e.name,
      e.group,
      typeInfo(r.type).label,
      r.start,
      requestEnd(r),
      unitLabel(r),
      fmtD(inPeriod),
      fmtD(r.type === "NPL" ? inPeriod : 0),
      approved?.by || "",
      approved?.at || "",
    ]);
  }
  return rows;
}

export function csvCell(s: string): string {
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

export interface ClaimRow {
  employeeId: string;
  name: string;
  scheme: string;
  start: string;
  end: string;
  days: string;
  employerPaidDays: string;
  reimbursableDays: string;
  dailyCap: string;
  child: string;
  statutory: string;
}

export function claimRows(state: AppState, year: number): ClaimRow[] {
  const rows: ClaimRow[] = [];
  const grouped = new Map<string, RequestRecord[]>();
  for (const r of state.requests) {
    if (r.status !== "Approved" || r.type !== "CCL" || Number(r.start.slice(0, 4)) !== year) continue;
    const key = r.employeeId + ":" + (r.band || "");
    grouped.set(key, [...(grouped.get(key) || []), r]);
  }
  for (const [, list] of grouped) {
    const sorted = [...list].sort((a, b) => (a.start < b.start ? -1 : 1));
    const first = sorted[0];
    const emp = empOf(state, first.employeeId);
    if (!emp) continue;
    const policy = policyFor(state, emp, first.start);
    const band = policy?.rules.childcare.bands.find((b) => b.id === first.band);
    if (!policy?.rules.childcare.statutoryClaim || !band?.reimbursable) continue;
    let running = 0;
    for (const r of sorted) {
      const before = running;
      running += r.days;
      const employer = Math.max(0, Math.min(r.days, band.employerPaidDays - before));
      const reimbursable = r2(r.days - employer);
      const child = emp.children[0];
      rows.push({
        employeeId: emp.id,
        name: emp.name,
        scheme: band.label,
        start: r.start,
        end: requestEnd(r),
        days: fmtD(r.days),
        employerPaidDays: fmtD(employer),
        reimbursableDays: fmtD(reimbursable),
        dailyCap: band.reimburseDailyCap ? "S$" + band.reimburseDailyCap : "",
        child: child ? (child.citizen ? "Singapore citizen" : "Not a Singapore citizen") + ", born " + child.dateOfBirth : "",
        statutory: "Yes",
      });
    }
  }
  for (const r of state.requests) {
    if (r.status !== "Approved" || (r.type !== "ML" && r.type !== "PL" && r.type !== "SPL")) continue;
    if (Number(r.start.slice(0, 4)) !== year) continue;
    const emp = empOf(state, r.employeeId);
    if (!emp || !emp.employmentActCovered) continue;
    const policy = policyFor(state, emp, r.start);
    if (!policy) continue;
    rows.push({
      employeeId: emp.id,
      name: emp.name,
      scheme: typeInfo(r.type).label,
      start: r.start,
      end: requestEnd(r),
      days: fmtD(r.days),
      employerPaidDays: "",
      reimbursableDays: fmtD(r.days),
      dailyCap: r.type === "SPL" ? "S$" + policy.rules.sharedParental.reimburseWeeklyCap + "/week" : "",
      child: emp.children[0] ? "born " + emp.children[0].dateOfBirth : "",
      statutory: "Yes",
    });
  }
  return rows.sort((a, b) => (a.start < b.start ? -1 : 1));
}

export function balanceTable(state: AppState, emp: EmployeeRecord, year: number, types: LeaveType[]) {
  return types.map((t) => {
    const b = balance(state, emp, t, year);
    return {
      type: t,
      label: typeInfo(t).label,
      entitlement: b.ent.total === null ? "No cap" : fmtD(b.ent.total),
      taken: fmtD(b.taken),
      pending: fmtD(b.pending),
      available: b.avail === null ? "No cap" : fmtD(b.avail),
      note: b.ent.note,
    };
  });
}

export function groupsIn(state: AppState): string[] {
  return [...new Set(state.employees.map((e) => e.group))];
}

export function blackoutLabel(b: BlackoutRecord): string {
  return b.mode === "Block" ? "Blocked" : "Warning only";
}
