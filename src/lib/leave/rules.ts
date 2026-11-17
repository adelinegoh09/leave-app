import type { ChildcareBand, PolicyRules, SickStep } from "./types";

const SICK_STEPS: SickStep[] = [
  { minMonths: 3, outpatient: 5, hospitalisation: 15 },
  { minMonths: 4, outpatient: 8, hospitalisation: 30 },
  { minMonths: 5, outpatient: 11, hospitalisation: 45 },
  { minMonths: 6, outpatient: 14, hospitalisation: 60 },
];

const CHILDCARE_BANDS: ChildcareBand[] = [
  {
    id: "gpcl",
    label: "Government-paid childcare leave",
    citizen: true,
    minAge: 0,
    maxAge: 6,
    days: 6,
    proRate: true,
    employerPaidDays: 3,
    reimbursable: true,
    reimburseDailyCap: 500,
    lifetimeCap: 42,
  },
  {
    id: "ecl",
    label: "Extended childcare leave",
    citizen: true,
    minAge: 7,
    maxAge: 12,
    days: 2,
    proRate: false,
    employerPaidDays: 0,
    reimbursable: true,
    reimburseDailyCap: 500,
    lifetimeCap: 12,
  },
  {
    id: "ea",
    label: "Employment Act childcare leave",
    citizen: false,
    minAge: 0,
    maxAge: 6,
    days: 2,
    proRate: false,
    employerPaidDays: 2,
    reimbursable: false,
    reimburseDailyCap: 0,
    lifetimeCap: 14,
  },
];

function baseRules(label: string, statutoryClaim: boolean, unpaidDivisor: number, escalationHours: number): PolicyRules {
  return {
    label,
    annual: {
      minServiceMonths: 3,
      mode: "mom-scale",
      flatDays: 14,
      baseDays: 7,
      extraPerYear: 1,
      maxDays: 14,
      proRateInJoinYear: true,
      unpaidDaysPerServiceMonth: unpaidDivisor,
    },
    sick: {
      minServiceMonths: 3,
      steps: SICK_STEPS.map((s) => ({ ...s })),
      hospitalisationIncludesOutpatient: true,
      mcRequired: true,
      noticeHours: 48,
    },
    childcare: {
      enabled: true,
      statutoryClaim,
      bands: CHILDCARE_BANDS.map((b) => ({ ...b })),
      enhanced: {
        inForce: false,
        maxAge: 12,
        daysForOne: 8,
        daysForTwo: 10,
        daysForThreeOrMore: 12,
        citizenOnly: true,
        keepNonCitizenFallback: true,
      },
    },
    maternity: {
      enabled: true,
      minServiceMonths: 3,
      citizenWeeks: 16,
      otherWeeks: 12,
      noticeWeeks: 4,
    },
    paternity: {
      enabled: true,
      minServiceMonths: 3,
      weeks: 4,
      eligibleBirthOnOrAfter: "2025-04-01",
      maxDaysPerWeek: 6,
      continuousWithinWeeks: 16,
      splitWithinMonths: 12,
    },
    sharedParental: {
      enabled: true,
      minServiceMonths: 3,
      noticeWeeks: 4,
      withinMonths: 12,
      reimburseWeeklyCap: 2500,
      tiers: [
        { birthFrom: "2025-04-01", birthTo: "2026-03-31", weeks: 6 },
        { birthFrom: "2026-04-01", birthTo: null, weeks: 10 },
      ],
    },
    unpaid: { enabled: true },
    oil: { enabled: true },
    carryForward: { cap: 5, expiry: "2027-03-31" },
    escalationHours,
  };
}

/** Shore staff covered by the Employment Act. Day counts follow MOM as at 17 Nov 2026. */
export function shoreRules(): PolicyRules {
  return baseRules(
    "Shore staff, Employment Act and government-paid leave",
    true,
    22,
    24,
  );
}

/**
 * Vessel crew are not covered by the Employment Act. These sample contract
 * terms use the same day counts as the shore baseline so the demo matches the
 * prototype. HR should replace them with the signed seafarer terms.
 * statutoryClaim is false: crew days are not put on the GPL claim pack.
 */
export function crewRules(): PolicyRules {
  return baseRules(
    "Crew contract (sample day counts aligned to the MOM scale, pending HR confirmation)",
    false,
    26,
    48,
  );
}

/** Announced at National Day Rally 2026. Not in force until HR activates a version. */
export function enhancedChildcareRules(): PolicyRules {
  const rules = shoreRules();
  rules.label = "Shore staff with the announced childcare increase (draft, not in force)";
  if (rules.childcare.enhanced) rules.childcare.enhanced.inForce = true;
  return rules;
}

export function summariseRules(rules: PolicyRules): string[] {
  const annual =
    rules.annual.mode === "flat"
      ? `Annual leave is a flat ${rules.annual.flatDays} days after ${rules.annual.minServiceMonths} months.`
      : `Annual leave is ${rules.annual.baseDays} days in year 1, plus ${rules.annual.extraPerYear} a year, capped at ${rules.annual.maxDays}, after ${rules.annual.minServiceMonths} months. Joiners are pro-rated.`;
  const sick = rules.sick.steps
    .map((s) => `${s.minMonths} months: ${s.outpatient} outpatient / ${s.hospitalisation} hospitalisation`)
    .join("; ");
  const child = rules.childcare.enhanced?.inForce
    ? `Childcare follows the announced scale: ${rules.childcare.enhanced.daysForOne}, ${rules.childcare.enhanced.daysForTwo} or ${rules.childcare.enhanced.daysForThreeOrMore} days for 1, 2 or 3+ children aged ${rules.childcare.enhanced.maxAge} and under.`
    : `Childcare bands: ${rules.childcare.bands.map((b) => `${b.label} ${b.days} days`).join("; ")}.`;
  return [
    rules.label,
    annual,
    `Outpatient and hospitalisation leave: ${sick}. Hospitalisation ${rules.sick.hospitalisationIncludesOutpatient ? "includes" : "is separate from"} outpatient days.`,
    child + (rules.childcare.statutoryClaim ? " Eligible days can go on the government claim pack." : " Not marked for government reimbursement."),
    `Carry forward up to ${rules.carryForward.cap} annual leave days, use by ${rules.carryForward.expiry}.`,
    `Maternity ${rules.maternity.citizenWeeks} weeks (citizen child) or ${rules.maternity.otherWeeks} weeks. Paternity ${rules.paternity.weeks} weeks for births on or after ${rules.paternity.eligibleBirthOnOrAfter}. Shared parental tiers: ${rules.sharedParental.tiers.map((t) => `${t.weeks} weeks from ${t.birthFrom}`).join("; ")}.`,
    `Approval escalation after ${rules.escalationHours} hours.`,
  ];
}

function num(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function validateRules(input: unknown): { ok: true; rules: PolicyRules } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return { ok: false, errors: ["Rules must be a JSON object."] };
  const r = input as PolicyRules;
  if (typeof r.label !== "string" || !r.label.trim()) errors.push("Add a label.");
  if (!r.annual || (r.annual.mode !== "mom-scale" && r.annual.mode !== "flat")) errors.push("Annual leave mode must be mom-scale or flat.");
  if (r.annual && (!num(r.annual.baseDays) || !num(r.annual.maxDays) || !num(r.annual.minServiceMonths) || !num(r.annual.extraPerYear))) {
    errors.push("Annual leave day counts must be numbers.");
  }
  if (!r.sick || !Array.isArray(r.sick.steps) || r.sick.steps.length === 0) errors.push("Add at least one sick-leave step.");
  if (!r.childcare || !Array.isArray(r.childcare.bands)) errors.push("Childcare bands must be a list.");
  if (!r.carryForward || !num(r.carryForward.cap) || !/^\d{4}-\d{2}-\d{2}$/.test(r.carryForward.expiry || "")) {
    errors.push("Carry-forward needs a cap and a use-by date (YYYY-MM-DD).");
  }
  if (!r.maternity || !num(r.maternity.citizenWeeks) || !num(r.maternity.otherWeeks)) errors.push("Maternity weeks must be numbers.");
  if (!r.paternity || !num(r.paternity.weeks)) errors.push("Paternity weeks must be a number.");
  if (!r.sharedParental || !Array.isArray(r.sharedParental.tiers)) errors.push("Shared parental tiers must be a list.");
  if (!num(r.escalationHours)) errors.push("Escalation hours must be a number.");
  if (errors.length) return { ok: false, errors };
  return { ok: true, rules: r };
}
