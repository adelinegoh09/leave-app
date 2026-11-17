import { notFound, redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { nice } from "@/lib/leave/dates";
import { updateEmployee } from "@/server/hr-actions";
import { currentEmployee } from "@/server/store";
import { prisma } from "@/lib/db";
import { isoDate } from "@/lib/leave/dates";

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const me = await currentEmployee();
  if (me.role !== "HR_ADMIN") redirect("/");
  const { id } = await params;
  const query = await searchParams;
  const employee = await prisma.employee.findUnique({ where: { id }, include: { group: true, children: true } });
  if (!employee) notFound();
  const people = await prisma.employee.findMany({ orderBy: { name: "asc" } });
  const groups = await prisma.orgGroup.findMany({ orderBy: { name: "asc" } });
  return (
    <section className="card">
      {query.notice ? <p className="flash">{query.notice}</p> : null}
      <h1>{employee.name}</h1>
      <p className="caption">{employee.email} · joined {nice(isoDate(employee.joinedOn))}</p>
      <ActionForm action={updateEmployee}>
        <input type="hidden" name="id" value={employee.id} />
        <div className="grid">
          <label className="field"><span>Name</span><input name="name" defaultValue={employee.name} required /></label>
          <label className="field"><span>Short name</span><input name="shortName" defaultValue={employee.shortName} /></label>
          <label className="field"><span>Email</span><input name="email" type="email" defaultValue={employee.email} required /></label>
          <label className="field"><span>Title</span><input name="title" defaultValue={employee.title} /></label>
          <label className="field"><span>Role</span>
            <select name="role" defaultValue={employee.role}><option value="EMPLOYEE">Employee</option><option value="MANAGER">Manager</option><option value="HR_ADMIN">HR admin</option></select>
          </label>
          <label className="field"><span>Category</span>
            <select name="category" defaultValue={employee.category}><option value="SHORE">Shore</option><option value="CREW">Crew</option></select>
          </label>
          <label className="field"><span>Group or vessel</span>
            <input name="group" list="groups" defaultValue={employee.group.name} required />
            <datalist id="groups">{groups.map((group) => <option key={group.id} value={group.name} />)}</datalist>
          </label>
          <label className="field"><span>Policy group</span><input name="policyGroup" defaultValue={employee.policyGroup} /></label>
          <label className="field"><span>Work pattern</span>
            <select name="workPattern" defaultValue={employee.workPattern}><option value="FIVE_DAY">Monday to Friday</option><option value="SIX_DAY">Monday to Saturday</option></select>
          </label>
          <label className="field"><span>Joined</span><input type="date" name="joined" defaultValue={isoDate(employee.joinedOn)} required /></label>
          <label className="field"><span>Approver</span>
            <select name="approverId" defaultValue={employee.approverId || ""}><option value="">HR queue</option>{people.filter((person) => person.id !== employee.id).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
          </label>
          <label className="field"><span>Second approver</span>
            <select name="secondApproverId" defaultValue={employee.secondApproverId || ""}><option value="">None</option>{people.filter((person) => person.id !== employee.id).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
          </label>
          <label className="field"><span>Employment Act</span>
            <select name="employmentActCovered" defaultValue={employee.employmentActCovered ? "yes" : "no"}><option value="yes">Covered</option><option value="no">Not covered (crew contract)</option></select>
          </label>
          <label className="field"><span>Active</span>
            <select name="active" defaultValue={employee.active ? "yes" : "no"}><option value="yes">Yes</option><option value="no">No</option></select>
          </label>
          <label className="field"><span>Set a new password</span><input name="password" type="password" autoComplete="new-password" /></label>
        </div>
        <h2 style={{ marginTop: "1rem" }}>Add a child</h2>
        <div className="grid">
          <label className="field"><span>Name</span><input name="childName" /></label>
          <label className="field"><span>Date of birth</span><input type="date" name="childDob" /></label>
          <label className="field"><span>Singapore citizen</span><select name="childCitizen" defaultValue="yes"><option value="yes">Yes</option><option value="no">No</option></select></label>
        </div>
        {employee.children.length ? (
          <ul>{employee.children.map((child) => <li key={child.id}>{child.name}, born {nice(isoDate(child.dateOfBirth))}, {child.singaporeCitizen ? "Singapore citizen" : "not a Singapore citizen"}</li>)}</ul>
        ) : <p className="caption">No child on record.</p>}
        <button className="btn primary" type="submit">Save employee</button>
      </ActionForm>
    </section>
  );
}
