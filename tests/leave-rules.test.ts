import { describe, expect, it } from "vitest";
import { balance, carryIn, checkDraft, selectPolicy, serviceMonths } from "@/lib/leave/engine";
import { completedMonths, roundHalfUp } from "@/lib/leave/dates";
import { buildSeedState } from "@/lib/leave/seed-data";
import { enhancedChildcareRules, shoreRules } from "@/lib/leave/rules";
import type { AppState, EmployeeRecord } from "@/lib/leave/types";

const state = buildSeedState();
const emp = (id: string) => state.employees.find((e) => e.id === id) as EmployeeRecord;

describe("MOM annual leave", () => {
  it("rounds half days up and smaller fractions down", () => {
    expect(roundHalfUp(3.5)).toBe(4);
    expect(roundHalfUp(3.49)).toBe(3);
    expect(roundHalfUp((7 * 6) / 12)).toBe(4);
    expect(roundHalfUp((7 * 7) / 12)).toBe(4);
  });

  it("counts completed months the way the prototype does", () => {
    expect(completedMonths("2019-03-01", "2026-01-01")).toBe(82);
    expect(completedMonths("2026-05-04", "2026-11-17")).toBe(6);
    expect(completedMonths("2026-05-04", "2026-12-31")).toBe(7);
    expect(completedMonths("2026-09-01", "2026-11-17")).toBe(2);
  });

  it("grants Tan Wei Ming 13 days plus 3 carried, year 7 of service", () => {
    const b = balance(state, emp("E01"), "AL", 2026);
    expect(b.ent.total).toBe(16);
    expect(b.ent.note).toContain("Year 7 of service");
    expect(b.taken).toBe(5);
    expect(b.pending).toBe(4);
    expect(b.avail).toBe(7);
  });

  it("pro-rates Lim Hui Min, who joined in May 2026, to 4 days", () => {
    const b = balance(state, emp("E04"), "AL", 2026);
    expect(b.ent.total).toBe(4);
    expect(b.taken).toBe(0.5);
    expect(b.avail).toBe(3.5);
    expect(b.ent.note).toContain("pro-rated");
  });

  it("gives Haris nothing until three months, from 1 Dec 2026", () => {
    const b = balance(state, emp("E10"), "AL", 2026);
    expect(b.ent.total).toBe(0);
    expect(b.ent.note).toContain("1 Dec 2026");
  });

  it("caps long service at 14 days before carry", () => {
    const b = balance(state, emp("E03"), "AL", 2026);
    expect(b.ent.base).toBe(14);
    expect(b.ent.carry).toBe(5);
    expect(b.ent.total).toBe(19);
  });

  it("carries unused 2026 leave into 2027, capped at 5, with a use-by date", () => {
    const carried = carryIn(state, emp("E04"), 2027);
    expect(carried.days).toBe(3.5);
    expect(carried.note).toContain("31 Mar 2027");
    const rajesh = carryIn(state, emp("E03"), 2027);
    expect(rajesh.days).toBe(5);
  });

  it("does not let carried days cover leave after the use-by date", () => {
    const draft = {
      employeeId: "E04",
      type: "AL" as const,
      unit: "full" as const,
      start: "2027-04-06",
      end: "2027-04-15",
      hours: 0,
      reason: "After the carry window",
      hasFile: false,
    };
    const early = checkDraft(state, { ...draft, start: "2027-03-01", end: "2027-03-10" });
    expect(early.days).toBe(7);
    expect(early.errors).toEqual([]);
    const late = checkDraft(state, draft);
    expect(late.days).toBe(8);
    expect(late.warnings.join(" ")).toContain("carried");
    expect(late.errors.join(" ")).toContain("Not enough");
  });

  it("drops a month of service for a block of unpaid leave", () => {
    const rules = shoreRules();
    const months = serviceMonths(state, emp("E08"), "2026-12-31", rules);
    const without = serviceMonths({ ...state, requests: state.requests.filter((r) => r.type !== "NPL") }, emp("E08"), "2026-12-31", rules);
    expect(without - months).toBe(0);
    const heavy: AppState = {
      ...state,
      requests: [
        ...state.requests,
        {
          id: "UNPAID",
          employeeId: "E04",
          type: "NPL",
          unit: "full",
          start: "2026-07-01",
          end: "2026-07-31",
          hours: 0,
          days: 22,
          reason: "unpaid",
          fileName: "",
          status: "Approved",
          pendingAction: "NONE",
          band: null,
          warnings: [],
          steps: [],
          trail: [],
          policyId: null,
        },
      ],
    };
    expect(serviceMonths(state, emp("E04"), "2026-11-17", rules) - serviceMonths(heavy, emp("E04"), "2026-11-17", rules)).toBe(1);
  });
});

describe("sick, hospitalisation and childcare", () => {
  it("steps outpatient and hospitalisation leave through the first six months", () => {
    const haris = balance(state, emp("E10"), "SL", 2026);
    expect(haris.ent.total).toBe(0);
    const huiMin = balance(state, emp("E04"), "SL", 2026);
    expect(huiMin.ent.total).toBe(14);
    expect(balance(state, emp("E04"), "HL", 2026).ent.total).toBe(60);
    const joined = "2026-05-04";
    const at = (today: string) => {
      const person: EmployeeRecord = { ...emp("E11"), id: "TEMP", joined, children: [] };
      const next: AppState = {
        ...state,
        today,
        employees: [...state.employees, person],
        openingCarry: [...state.openingCarry, { employeeId: "TEMP", year: 2026, type: "AL", days: 0 }],
      };
      return {
        sl: balance(next, person, "SL", 2026).ent.total,
        hl: balance(next, person, "HL", 2026).ent.total,
      };
    };
    expect(at("2026-08-04")).toEqual({ sl: 5, hl: 15 });
    expect(at("2026-09-04")).toEqual({ sl: 8, hl: 30 });
    expect(at("2026-10-04")).toEqual({ sl: 11, hl: 45 });
    expect(at("2026-11-04")).toEqual({ sl: 14, hl: 60 });
  });

  it("shares the hospitalisation cap with outpatient sick leave", () => {
    const koko = balance(state, emp("E07"), "HL", 2026);
    expect(koko.taken).toBe(6);
    expect(koko.avail).toBe(54);
    const sl = balance(state, emp("E07"), "SL", 2026);
    expect(sl.avail).toBe(14);
    const full: AppState = {
      ...state,
      requests: [
        ...state.requests,
        {
          id: "SICKFILL",
          employeeId: "E07",
          type: "HL",
          unit: "full",
          start: "2026-03-02",
          end: "2026-03-07",
          hours: 0,
          days: 54,
          reason: "",
          fileName: "mc.pdf",
          status: "Approved",
          pendingAction: "NONE",
          band: null,
          warnings: [],
          steps: [],
          trail: [],
          policyId: null,
        },
      ],
    };
    expect(balance(full, emp("E07"), "SL", 2026).avail).toBe(0);
    expect(balance(full, emp("E07"), "HL", 2026).avail).toBe(0);
  });

  it("gives six government-paid days, two extended days, or two Employment Act days", () => {
    const wei = balance(state, emp("E01"), "CCL", 2026);
    expect(wei.ent.total).toBe(6);
    expect(wei.taken).toBe(2);
    expect(wei.avail).toBe(4);
    expect(wei.ent.band).toBe("gpcl");
    const aisyah = balance(state, emp("E02"), "CCL", 2026);
    expect(aisyah.ent.total).toBe(2);
    expect(aisyah.ent.band).toBe("ecl");
    const koko = balance(state, emp("E07"), "CCL", 2026);
    expect(koko.ent.total).toBe(2);
    expect(koko.ent.band).toBe("ea");
    expect(balance(state, emp("E09"), "CCL", 2026).avail).toBe(0);
  });

  it("pro-rates government-paid childcare for a new hire using MOM's table", () => {
    const parent: EmployeeRecord = {
      ...emp("E04"),
      children: [{ name: "Lim Bo", dateOfBirth: "2024-01-01", citizen: true }],
    };
    const custom: AppState = { ...state, employees: state.employees.map((e) => (e.id === "E04" ? parent : e)) };
    const b = balance(custom, parent, "CCL", 2026);
    expect(b.ent.total).toBe(3);
    expect(b.ent.note).toContain("pro-rated");
  });

  it("keeps the announced 8/10/12-day scale inactive until its effective date", () => {
    const current = selectPolicy(state.policies, "SHORE", "2026-11-17");
    expect(current?.id).toBe("pol_shore");
    expect(current?.rules.childcare.enhanced?.inForce).toBe(false);
    const draft = selectPolicy(state.policies, "SHORE", "2027-08-01");
    expect(draft?.id).toBe("pol_shore");
    const activated = state.policies.map((p) => {
      if (p.id === "pol_shore") return { ...p, effectiveTo: "2027-06-30" };
      if (p.id === "pol_enhanced") return { ...p, status: "ACTIVE" as const, rules: enhancedChildcareRules() };
      return p;
    });
    const next = selectPolicy(activated, "SHORE", "2027-08-01");
    expect(next?.id).toBe("pol_enhanced");
    const parent: EmployeeRecord = {
      ...emp("E01"),
      children: [
        { name: "A", dateOfBirth: "2022-01-01", citizen: true },
        { name: "B", dateOfBirth: "2020-01-01", citizen: true },
      ],
    };
    const future: AppState = {
      ...state,
      today: "2027-08-01",
      policies: activated,
      employees: state.employees.map((e) => (e.id === "E01" ? parent : e)),
    };
    expect(balance(future, parent, "CCL", 2027).ent.total).toBe(10);
    expect(balance(future, parent, "CCL", 2027).ent.band).toBe("enhanced");
    expect(balance({ ...future, today: "2027-06-01" }, parent, "CCL", 2027).ent.band).not.toBe("enhanced");
  });

  it("uses the crew contract for crew and the shore policy for shore staff", () => {
    expect(selectPolicy(state.policies, "CREW", "2026-11-17")?.rules.childcare.statutoryClaim).toBe(false);
    expect(selectPolicy(state.policies, "SHORE", "2026-11-17")?.rules.childcare.statutoryClaim).toBe(true);
    expect(emp("E06").employmentActCovered).toBe(false);
    expect(balance(state, emp("E06"), "AL", 2026).ent.base).toBe(14);
  });
});

describe("working days and public holidays", () => {
  it("skips Saturdays for shore staff and counts them for crew", () => {
    const shore = checkDraft(state, {
      employeeId: "E01",
      type: "AL",
      unit: "full",
      start: "2026-12-07",
      end: "2026-12-12",
      hours: 0,
      reason: "",
      hasFile: false,
    });
    expect(shore.days).toBe(5);
    const crew = checkDraft(state, {
      employeeId: "E08",
      type: "NPL",
      unit: "full",
      start: "2026-12-07",
      end: "2026-12-12",
      hours: 0,
      reason: "Home",
      hasFile: false,
    });
    expect(crew.days).toBe(6);
  });

  it("excludes the observed Monday when a holiday falls on Sunday", () => {
    const result = checkDraft(state, {
      employeeId: "E01",
      type: "AL",
      unit: "full",
      start: "2027-02-08",
      end: "2027-02-12",
      hours: 0,
      reason: "After Chinese New Year",
      hasFile: false,
    });
    expect(result.days).toBe(4);
    expect(result.holidays.join(" ")).toContain("Chinese New Year");
  });
});
