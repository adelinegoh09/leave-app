import { redirect } from "next/navigation";
import { acceptPdpa } from "@/server/auth-actions";
import { currentEmployee } from "@/server/store";

export const dynamic = "force-dynamic";

export default async function PdpaPage() {
  const employee = await currentEmployee();
  return (
    <main id="content" className="page" style={{ maxWidth: 760 }}>
      <section className="card">
        <h1>How leave records are used</h1>
        <p>Global Marine Transportation Pte Ltd collects the details needed to administer leave, payroll exports and government-paid leave claims.</p>
        <ul>
          <li>Your applications, balances and approver comments are visible to you, your approver and HR.</li>
          <li>Medical certificates and hospital documents are visible only to you, your approver (including a named backup) and HR. They are kept for two years after the leave ends, then deleted.</li>
          <li>A child&apos;s name, date of birth and Singapore citizenship are collected only for childcare and parental leave.</li>
          <li>The team calendar shows who is away and the leave type. It does not show medical documents or the reason you wrote.</li>
          <li>Crew records follow the crew contract policy. Seafarers are not covered by the Employment Act, which is stored on each person&apos;s profile.</li>
        </ul>
        {employee.pdpaAcceptedAt ? (
          <p><a href="/">Back to leave</a></p>
        ) : (
          <form action={acceptPdpa}>
            <label className="row"><input type="checkbox" name="accept" required style={{ width: "1.1rem" }} /> I understand how my leave and medical information will be used.</label>
            <div className="row" style={{ marginTop: "0.8rem" }}><button className="btn primary" type="submit">Continue</button></div>
          </form>
        )}
      </section>
    </main>
  );
}
