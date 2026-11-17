import { countDays } from "./engine";
import { parseSgStamp } from "./dates";
import { HOLIDAYS } from "./holidays";
import { crewRules, enhancedChildcareRules, shoreRules } from "./rules";
import type { AppState, EmployeeRecord, LeaveType, RequestRecord, Unit } from "./types";

const TODAY = "2026-11-17";

function child(ageIn2026: number, citizen: boolean, name: string) {
  return { name, dateOfBirth: `${2026 - ageIn2026}-01-01`, citizen };
}

export const SEED_EMPLOYEES: EmployeeRecord[] = [
  { id: "E01", email: "wei.ming@gmt.example", name: "Tan Wei Ming", shortName: "Wei Ming", title: "Operations Executive", role: "EMPLOYEE", category: "SHORE", employmentActCovered: true, policyGroup: "SHORE", group: "Shore office", workPattern: "FIVE_DAY", joined: "2019-03-01", approverId: "E03", secondApproverId: null, children: [child(4, true, "Tan Jia En")], active: true },
  { id: "E02", email: "aisyah.rahman@gmt.example", name: "Nur Aisyah binte Rahman", shortName: "Aisyah", title: "Accounts Executive", role: "EMPLOYEE", category: "SHORE", employmentActCovered: true, policyGroup: "SHORE", group: "Shore office", workPattern: "FIVE_DAY", joined: "2023-06-15", approverId: "E03", secondApproverId: null, children: [child(9, true, "Nur Damia")], active: true },
  { id: "E03", email: "rajesh.kumar@gmt.example", name: "Rajesh Kumar", shortName: "Rajesh", title: "Operations Manager", role: "MANAGER", category: "SHORE", employmentActCovered: true, policyGroup: "SHORE", group: "Shore office", workPattern: "FIVE_DAY", joined: "2012-08-01", approverId: null, secondApproverId: null, children: [], active: true },
  { id: "E04", email: "hui.min@gmt.example", name: "Lim Hui Min", shortName: "Hui Min", title: "HR and Admin Assistant", role: "EMPLOYEE", category: "SHORE", employmentActCovered: true, policyGroup: "SHORE", group: "Shore office", workPattern: "FIVE_DAY", joined: "2026-05-04", approverId: "E03", secondApproverId: null, children: [], active: true },
  { id: "E05", email: "jason.ong@gmt.example", name: "Jason Ong", shortName: "Jason", title: "Marine Superintendent", role: "MANAGER", category: "SHORE", employmentActCovered: true, policyGroup: "SHORE", group: "Shore office", workPattern: "FIVE_DAY", joined: "2015-02-02", approverId: null, secondApproverId: null, children: [child(2, true, "Ong Rui En")], active: true },
  { id: "E06", email: "faizal.ismail@gmt.example", name: "Capt. Mohd Faizal bin Ismail", shortName: "Capt. Faizal", title: "Master", role: "EMPLOYEE", category: "CREW", employmentActCovered: false, policyGroup: "CREW", group: "MT Marina Star", workPattern: "SIX_DAY", joined: "2016-10-01", approverId: "E05", secondApproverId: null, children: [], active: true },
  { id: "E07", email: "aung.koko@gmt.example", name: "Aung Ko Ko", shortName: "Ko Ko", title: "Chief Officer", role: "EMPLOYEE", category: "CREW", employmentActCovered: false, policyGroup: "CREW", group: "MT Marina Star", workPattern: "SIX_DAY", joined: "2021-01-11", approverId: "E05", secondApproverId: null, children: [child(5, false, "Aung Min")], active: true },
  { id: "E08", email: "rizal.santos@gmt.example", name: "Rizal Santos", shortName: "Rizal", title: "Able Seaman", role: "EMPLOYEE", category: "CREW", employmentActCovered: false, policyGroup: "CREW", group: "MT Marina Star", workPattern: "SIX_DAY", joined: "2024-04-01", approverId: "E05", secondApproverId: null, children: [], active: true },
  { id: "E09", email: "kok.leong@gmt.example", name: "Teo Kok Leong", shortName: "Kok Leong", title: "Barge Master", role: "EMPLOYEE", category: "CREW", employmentActCovered: false, policyGroup: "CREW", group: "Barge Coral Bay", workPattern: "SIX_DAY", joined: "2018-07-16", approverId: "E05", secondApproverId: null, children: [child(11, true, "Teo Xin Yi")], active: true },
  { id: "E10", email: "haris.pratama@gmt.example", name: "Haris Pratama", shortName: "Haris", title: "Deckhand", role: "EMPLOYEE", category: "CREW", employmentActCovered: false, policyGroup: "CREW", group: "Barge Coral Bay", workPattern: "SIX_DAY", joined: "2026-09-01", approverId: "E05", secondApproverId: null, children: [], active: true },
  { id: "E11", email: "adeline.goh@gmt.example", name: "Adeline Goh", shortName: "Adeline", title: "HR, Admin and Finance", role: "HR_ADMIN", category: "SHORE", employmentActCovered: true, policyGroup: "SHORE", group: "Shore office", workPattern: "FIVE_DAY", joined: "2014-01-06", approverId: "E03", secondApproverId: null, children: [], active: true },
];

type SeedRow = {
  emp: string;
  type: LeaveType;
  unit: Unit;
  start: string;
  end: string;
  hours: number;
  reason: string;
  file: string;
  status: "Pending" | "Approved" | "Rejected";
  submitted: string;
  decided: string;
  note: string;
  band?: string;
  warnings?: string[];
};

const ROWS: SeedRow[] = [
  { emp: "E01", type: "AL", unit: "full", start: "2026-03-09", end: "2026-03-13", hours: 0, reason: "Family trip to Penang", file: "", status: "Approved", submitted: "20 Feb 2026, 09:12", decided: "20 Feb 2026, 14:30", note: "Enjoy" },
  { emp: "E01", type: "CCL", unit: "full", start: "2026-07-06", end: "2026-07-07", hours: 0, reason: "School holiday childcare", file: "", status: "Approved", submitted: "22 Jun 2026, 10:01", decided: "22 Jun 2026, 11:45", note: "", band: "gpcl" },
  { emp: "E01", type: "SL", unit: "full", start: "2026-09-14", end: "2026-09-14", hours: 0, reason: "Fever", file: "MC_TanWeiMing_14Sep.jpg", status: "Approved", submitted: "14 Sep 2026, 08:20", decided: "14 Sep 2026, 09:05", note: "Get well soon" },
  { emp: "E02", type: "AL", unit: "full", start: "2026-06-01", end: "2026-06-05", hours: 0, reason: "Hari Raya visits", file: "", status: "Approved", submitted: "11 May 2026, 16:40", decided: "12 May 2026, 09:10", note: "" },
  { emp: "E02", type: "SL", unit: "am", start: "2026-08-20", end: "2026-08-20", hours: 0, reason: "Dental appointment", file: "MC_Dental_20Aug.pdf", status: "Approved", submitted: "20 Aug 2026, 13:30", decided: "20 Aug 2026, 15:02", note: "" },
  { emp: "E03", type: "AL", unit: "full", start: "2026-12-21", end: "2026-12-24", hours: 0, reason: "Year-end family holiday", file: "", status: "Approved", submitted: "2 Nov 2026, 11:00", decided: "3 Nov 2026, 10:15", note: "Jason covers operations" },
  { emp: "E04", type: "AL", unit: "hours", start: "2026-10-16", end: "2026-10-16", hours: 4, reason: "Personal errand", file: "", status: "Approved", submitted: "13 Oct 2026, 17:05", decided: "14 Oct 2026, 09:30", note: "" },
  { emp: "E05", type: "AL", unit: "full", start: "2026-04-06", end: "2026-04-10", hours: 0, reason: "Overseas trip", file: "", status: "Approved", submitted: "9 Mar 2026, 10:00", decided: "9 Mar 2026, 12:00", note: "" },
  { emp: "E06", type: "AL", unit: "full", start: "2026-05-04", end: "2026-05-09", hours: 0, reason: "Home leave", file: "", status: "Approved", submitted: "6 Apr 2026, 07:45", decided: "6 Apr 2026, 10:20", note: "Relief master arranged" },
  { emp: "E06", type: "SL", unit: "full", start: "2026-11-12", end: "2026-11-12", hours: 0, reason: "Gastric flu", file: "MC_Faizal_12Nov.jpg", status: "Approved", submitted: "12 Nov 2026, 06:50", decided: "12 Nov 2026, 08:15", note: "" },
  { emp: "E07", type: "HL", unit: "full", start: "2026-02-02", end: "2026-02-07", hours: 0, reason: "Hospitalised for dengue", file: "Discharge_memo_AungKoKo.pdf", status: "Approved", submitted: "9 Feb 2026, 09:00", decided: "9 Feb 2026, 09:40", note: "Take care" },
  { emp: "E08", type: "AL", unit: "full", start: "2026-08-10", end: "2026-08-15", hours: 0, reason: "Short break", file: "", status: "Rejected", submitted: "20 Jul 2026, 10:00", decided: "20 Jul 2026, 15:20", note: "Vessel short-handed during charter, please pick September" },
  { emp: "E08", type: "NPL", unit: "full", start: "2026-11-23", end: "2026-11-28", hours: 0, reason: "Family matter back home", file: "", status: "Approved", submitted: "2 Nov 2026, 19:10", decided: "3 Nov 2026, 08:30", note: "Approved as unpaid" },
  { emp: "E09", type: "OIL", unit: "full", start: "2026-11-10", end: "2026-11-10", hours: 0, reason: "Rest after working on Deepavali", file: "", status: "Approved", submitted: "9 Nov 2026, 18:00", decided: "9 Nov 2026, 18:40", note: "" },
  { emp: "E09", type: "CCL", unit: "full", start: "2026-11-19", end: "2026-11-20", hours: 0, reason: "Child's exam week", file: "", status: "Approved", submitted: "5 Nov 2026, 12:00", decided: "5 Nov 2026, 14:00", note: "", band: "ecl" },
  { emp: "E02", type: "AL", unit: "pm", start: "2026-11-27", end: "2026-11-27", hours: 0, reason: "Child's school concert", file: "", status: "Pending", submitted: "17 Nov 2026, 08:45", decided: "", note: "" },
  { emp: "E01", type: "AL", unit: "full", start: "2026-12-28", end: "2026-12-31", hours: 0, reason: "Year-end break", file: "", status: "Pending", submitted: "16 Nov 2026, 18:22", decided: "", note: "", warnings: ["Falls in a blackout period: Year-end closing, 28 Dec 2026 to 31 Dec 2026 (Shore office). Your approver will see this warning."] },
  { emp: "E07", type: "OIL", unit: "full", start: "2026-11-30", end: "2026-11-30", hours: 0, reason: "Rest after weekend bunkering", file: "", status: "Pending", submitted: "16 Nov 2026, 21:05", decided: "", note: "" },
  { emp: "E03", type: "AL", unit: "full", start: "2027-01-04", end: "2027-01-08", hours: 0, reason: "Trip to Japan", file: "", status: "Pending", submitted: "15 Nov 2026, 09:30", decided: "", note: "" },
];

function person(id: string): EmployeeRecord {
  const found = SEED_EMPLOYEES.find((e) => e.id === id);
  if (!found) throw new Error(id);
  return found;
}

function approverDisplay(id: string | null): string {
  if (!id) return "HR admin";
  return person(id).name;
}

export function buildSeedState(today = TODAY): AppState {
  const employees = SEED_EMPLOYEES;
  const requests: RequestRecord[] = ROWS.map((row, i) => {
    const e = person(row.emp);
    const days = countDays(e, row.unit, row.start, row.end, row.hours, HOLIDAYS, row.type === "ML");
    const stepStatus = row.status === "Approved" ? "Approved" : row.status === "Rejected" ? "Rejected" : "Pending";
    const trail = [{ at: parseSgStamp(row.submitted), by: e.name, action: "Submitted", note: row.reason }];
    if (row.status === "Approved" || row.status === "Rejected") {
      trail.push({ at: parseSgStamp(row.decided), by: approverDisplay(e.approverId), action: row.status, note: row.note });
    }
    return {
      id: "L" + (101 + i),
      employeeId: e.id,
      type: row.type,
      unit: row.unit,
      start: row.start,
      end: row.unit === "full" ? row.end : row.start,
      hours: row.unit === "hours" ? row.hours : 0,
      days,
      reason: row.reason,
      fileName: row.file,
      status: row.status,
      pendingAction: "NONE",
      band: row.band || null,
      warnings: row.warnings || [],
      steps: [{ level: 1, approverId: e.approverId, status: stepStatus }],
      trail,
      policyId: e.policyGroup === "CREW" ? "pol_crew" : "pol_shore",
    };
  });
  return {
    today,
    employees,
    requests,
    credits: [
      { id: "C1", employeeId: "E09", days: 1, date: "2026-11-08", reason: "Worked on Deepavali (rest day)", expiresOn: null },
      { id: "C2", employeeId: "E07", days: 2, date: "2026-10-11", reason: "Weekend bunkering, 10 and 11 Oct", expiresOn: null },
      { id: "C3", employeeId: "E06", days: 1, date: "2026-08-09", reason: "Worked on National Day (rest day)", expiresOn: null },
    ],
    blackouts: [
      { id: "B1", start: "2026-12-28", end: "2026-12-31", scope: "Shore office", mode: "Warn", label: "Year-end closing" },
      { id: "B2", start: "2027-01-04", end: "2027-01-15", scope: "Barge Coral Bay", mode: "Block", label: "Dry dock" },
    ],
    policies: [
      { id: "pol_shore", name: "Shore MOM baseline", policyGroup: "SHORE", effectiveFrom: "2024-01-01", effectiveTo: null, status: "ACTIVE", rules: shoreRules(), changeNote: "Employment Act and government-paid leave as published on 17 Nov 2026." },
      { id: "pol_crew", name: "Crew contract sample", policyGroup: "CREW", effectiveFrom: "2024-01-01", effectiveTo: null, status: "ACTIVE", rules: crewRules(), changeNote: "Sample contract aligned to MOM day counts. Seafarers are not covered by the Employment Act. Confirm with HR before go-live." },
      { id: "pol_enhanced", name: "Announced childcare increase", policyGroup: "SHORE", effectiveFrom: "2027-07-01", effectiveTo: null, status: "DRAFT", rules: enhancedChildcareRules(), changeNote: "National Day Rally 2026 announcement: 8, 10 or 12 days. Start date is not set. This draft does not apply until HR activates it." },
    ],
    holidays: { ...HOLIDAYS },
    openingCarry: SEED_EMPLOYEES.map((e) => ({
      employeeId: e.id,
      year: 2026,
      type: "AL" as const,
      days: ({ E01: 3, E02: 2, E03: 5, E04: 0, E05: 4, E06: 5, E07: 0, E08: 1, E09: 5, E10: 0, E11: 0 } as Record<string, number>)[e.id] ?? 0,
    })),
    delegations: [],
    seq: 201,
  };
}

export const DEMO_PASSWORD = "Harbour-Leave-2026";
export const SEED_TODAY = TODAY;
