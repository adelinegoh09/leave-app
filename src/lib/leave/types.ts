export type Role = "EMPLOYEE" | "MANAGER" | "HR_ADMIN";
export type Category = "SHORE" | "CREW";
export type WorkPattern = "FIVE_DAY" | "SIX_DAY";
export type LeaveType = "AL" | "SL" | "HL" | "CCL" | "OIL" | "NPL" | "ML" | "PL" | "SPL";
export type Unit = "full" | "am" | "pm" | "hours";
export type ReqStatus = "Pending" | "Approved" | "Rejected" | "Cancelled";
export type StepStatus = "Pending" | "Approved" | "Rejected" | "Waiting";
export type BlackoutMode = "Block" | "Warn";
export type PolicyStatus = "DRAFT" | "ACTIVE" | "SUPERSEDED";
export type PendingAction = "NONE" | "CANCEL";

export interface LeaveTypeInfo {
  value: LeaveType;
  label: string;
  short: string;
  parental?: boolean;
}

export const LEAVE_TYPES: LeaveTypeInfo[] = [
  { value: "AL", label: "Annual leave", short: "Annual" },
  { value: "SL", label: "Sick leave (MC)", short: "MC" },
  { value: "HL", label: "Hospitalisation leave", short: "Hosp." },
  { value: "CCL", label: "Childcare leave", short: "Childcare" },
  { value: "OIL", label: "Off-in-lieu", short: "Off-in-lieu" },
  { value: "NPL", label: "Unpaid leave", short: "Unpaid" },
  { value: "ML", label: "Maternity leave", short: "Maternity", parental: true },
  { value: "PL", label: "Paternity leave", short: "Paternity", parental: true },
  { value: "SPL", label: "Shared parental leave", short: "Shared parental", parental: true },
];

export const CORE_TYPES = LEAVE_TYPES.filter((t) => !t.parental);
export const PARENTAL_TYPES = LEAVE_TYPES.filter((t) => t.parental);

export const UNITS: { value: Unit; label: string }[] = [
  { value: "full", label: "Full day(s)" },
  { value: "am", label: "Half day (AM)" },
  { value: "pm", label: "Half day (PM)" },
  { value: "hours", label: "Hours (time off)" },
];

export function typeInfo(t: LeaveType): LeaveTypeInfo {
  return LEAVE_TYPES.find((x) => x.value === t) || LEAVE_TYPES[0];
}

export interface ChildRecord {
  name: string;
  dateOfBirth: string;
  citizen: boolean;
}

export interface EmployeeRecord {
  id: string;
  email: string;
  name: string;
  shortName: string;
  title: string;
  role: Role;
  category: Category;
  employmentActCovered: boolean;
  policyGroup: string;
  group: string;
  workPattern: WorkPattern;
  joined: string;
  approverId: string | null;
  secondApproverId: string | null;
  children: ChildRecord[];
  active: boolean;
}

export interface SickStep {
  minMonths: number;
  outpatient: number;
  hospitalisation: number;
}

export interface ChildcareBand {
  id: string;
  label: string;
  citizen: boolean;
  minAge: number;
  maxAge: number;
  days: number;
  proRate: boolean;
  employerPaidDays: number;
  reimbursable: boolean;
  reimburseDailyCap: number;
  lifetimeCap: number | null;
}

export interface PolicyRules {
  label: string;
  annual: {
    minServiceMonths: number;
    mode: "mom-scale" | "flat";
    flatDays: number;
    baseDays: number;
    extraPerYear: number;
    maxDays: number;
    proRateInJoinYear: boolean;
    unpaidDaysPerServiceMonth: number;
  };
  sick: {
    minServiceMonths: number;
    steps: SickStep[];
    hospitalisationIncludesOutpatient: boolean;
    mcRequired: boolean;
    noticeHours: number;
  };
  childcare: {
    enabled: boolean;
    statutoryClaim: boolean;
    bands: ChildcareBand[];
    enhanced: {
      inForce: boolean;
      maxAge: number;
      daysForOne: number;
      daysForTwo: number;
      daysForThreeOrMore: number;
      citizenOnly: boolean;
      keepNonCitizenFallback: boolean;
    } | null;
  };
  maternity: {
    enabled: boolean;
    minServiceMonths: number;
    citizenWeeks: number;
    otherWeeks: number;
    noticeWeeks: number;
  };
  paternity: {
    enabled: boolean;
    minServiceMonths: number;
    weeks: number;
    eligibleBirthOnOrAfter: string;
    maxDaysPerWeek: number;
    continuousWithinWeeks: number;
    splitWithinMonths: number;
  };
  sharedParental: {
    enabled: boolean;
    minServiceMonths: number;
    noticeWeeks: number;
    withinMonths: number;
    reimburseWeeklyCap: number;
    tiers: { birthFrom: string; birthTo: string | null; weeks: number }[];
  };
  unpaid: { enabled: boolean };
  oil: { enabled: boolean };
  carryForward: { cap: number; expiry: string };
  escalationHours: number;
}

export interface PolicyRecord {
  id: string;
  name: string;
  policyGroup: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: PolicyStatus;
  rules: PolicyRules;
  changeNote: string;
}

export interface StepRecord {
  level: number;
  approverId: string | null;
  status: StepStatus;
}

export interface TrailRecord {
  at: string;
  by: string;
  action: string;
  note: string;
}

export interface RequestRecord {
  id: string;
  employeeId: string;
  type: LeaveType;
  unit: Unit;
  start: string;
  end: string;
  hours: number;
  days: number;
  reason: string;
  fileName: string;
  status: ReqStatus;
  pendingAction: PendingAction;
  band: string | null;
  warnings: string[];
  steps: StepRecord[];
  trail: TrailRecord[];
  policyId: string | null;
}

export interface CreditRecord {
  id: string;
  employeeId: string;
  days: number;
  date: string;
  reason: string;
  expiresOn: string | null;
}

export interface OpeningCarry {
  employeeId: string;
  year: number;
  type: LeaveType;
  days: number;
}

export interface BlackoutRecord {
  id: string;
  start: string;
  end: string;
  scope: string;
  mode: BlackoutMode;
  label: string;
}

export interface DelegationRecord {
  id: string;
  fromId: string;
  toId: string;
  start: string;
  end: string;
}

export interface AppState {
  today: string;
  employees: EmployeeRecord[];
  requests: RequestRecord[];
  credits: CreditRecord[];
  blackouts: BlackoutRecord[];
  policies: PolicyRecord[];
  holidays: Record<string, string>;
  openingCarry: OpeningCarry[];
  delegations: DelegationRecord[];
  seq: number;
}

export interface Draft {
  employeeId: string;
  type: LeaveType;
  unit: Unit;
  start: string;
  end: string;
  hours: number;
  reason: string;
  hasFile: boolean;
  fileName?: string;
  childDateOfBirth?: string;
  childCitizen?: boolean;
  blackoutOverride?: boolean;
  backdateOverride?: boolean;
  overrideReason?: string;
}

export interface Entitlement {
  total: number | null;
  note: string;
  band: string | null;
  base: number | null;
  carry: number;
}

export interface Balance {
  ent: Entitlement;
  taken: number;
  pending: number;
  avail: number | null;
}

export interface CheckResult {
  days: number;
  errors: string[];
  warnings: string[];
  holidays: string[];
  band: string | null;
}

export interface Actor {
  id: string;
  name: string;
  role: Role;
}

export type FlowResult =
  | { ok: true; state: AppState; request: RequestRecord }
  | { ok: false; errors: string[] };
