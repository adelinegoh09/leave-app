import { redirect } from "next/navigation";
import { auth, providerFlags } from "@/auth";
import { sendMagicLink, signInWithEntra, signInWithPassword } from "@/server/auth-actions";
import { ActionForm } from "@/components/action-form";
import { DEMO_PASSWORD, SEED_EMPLOYEES } from "@/lib/leave/seed-data";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.email) redirect("/");
  const demo = process.env.DEMO_LOGIN === "true";
  return (
    <main id="content" className="page" style={{ maxWidth: 720 }}>
      <section className="card">
        <p className="caption" style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}>Global Marine Transportation Pte Ltd</p>
        <h1>Sign in to leave</h1>
        <p>Shore staff can use Microsoft 365. Everyone on the staff list can also use a password or an email sign-in link.</p>
        <ActionForm action={signInWithPassword}>
          <div className="grid">
            <label className="field"><span>Work email</span><input name="email" type="email" autoComplete="username" required /></label>
            <label className="field"><span>Password</span><input name="password" type="password" autoComplete="current-password" required /></label>
          </div>
          <div className="row" style={{ marginTop: "0.8rem" }}>
            <button className="btn primary" type="submit">Sign in</button>
          </div>
        </ActionForm>
        {providerFlags.magicLink ? (
          <ActionForm action={sendMagicLink}>
            <div className="row" style={{ marginTop: "0.8rem" }}>
              <label className="field" style={{ flex: 1 }}><span>Email me a sign-in link</span><input name="email" type="email" required /></label>
              <button className="btn" type="submit">Send link</button>
            </div>
          </ActionForm>
        ) : null}
        {providerFlags.entra ? (
          <form action={signInWithEntra} style={{ marginTop: "0.8rem" }}>
            <button className="btn" type="submit">Sign in with Microsoft</button>
          </form>
        ) : (
          <p className="caption">Microsoft Entra sign-in appears here once the app registration values are set.</p>
        )}
      </section>
      {demo ? (
        <section className="card">
          <h2>Demo staff</h2>
          <p className="caption">Fictional people. Shared password <strong>{DEMO_PASSWORD}</strong>. Turn DEMO_LOGIN off before production.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Role</th><th>Email</th></tr></thead>
              <tbody>
                {SEED_EMPLOYEES.map((person) => (
                  <tr key={person.id}><td>{person.name}</td><td>{person.role === "HR_ADMIN" ? "HR admin" : person.role === "MANAGER" ? "Manager" : "Employee"}</td><td>{person.email}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
