# Leave · Global Marine Transportation

Leave applications for shore staff and vessel crew at Global Marine Transportation Pte Ltd. Staff apply from a phone or a desk, managers approve, and HR keeps the Singapore rules, blackout dates, payroll export and audit history.

The rules are data. Annual leave, sick leave, hospitalisation leave, childcare leave, maternity, paternity, shared parental leave, off-in-lieu and unpaid leave are calculated from a policy version with an effective date. Shore staff use the Employment Act policy. Vessel crew are not covered by the Employment Act and use a separate contract policy. A draft policy holds the childcare increase announced at the 2026 National Day Rally (8, 10 or 12 days) so HR can turn it on without a code change once the start date is known.

## What you can do

- Sign in with Microsoft Entra ID, an email magic link, or an email and password.
- Apply for a full day, a half day (AM or PM) or a few hours, and see the balance before you submit.
- Attach a medical certificate. Only the applicant, their approver (including a named backup) and HR can download it.
- Approve or reject, name a backup approver, and add a second approval step.
- See the team calendar, public holidays, balances and a leave-taken report.
- Credit off-in-lieu, set blackout dates, publish carry-forward rules, import employees from CSV, and export payroll and government-paid leave claim files.
- Every change is written to the audit log.

## Local setup

You need Node.js 22 and Postgres 16. Docker is optional.

```bash
cp .env.example .env
docker compose up -d          # or use a local Postgres and set DATABASE_URL
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Open http://localhost:3000. With `DEMO_LOGIN=true` the sign-in page lists the fictional staff. The shared demo password is `Harbour-Leave-2026`.

| Person | Role | Email |
| --- | --- | --- |
| Tan Wei Ming | Employee | wei.ming@gmt.example |
| Rajesh Kumar | Manager, shore | rajesh.kumar@gmt.example |
| Jason Ong | Manager, vessels | jason.ong@gmt.example |
| Adeline Goh | HR admin | adeline.goh@gmt.example |

The other six employees from the prototype are seeded too. Crew profiles are marked as not covered by the Employment Act.

A useful path: sign in as Tan Wei Ming, accept the privacy notice, submit 7 to 9 Dec 2026, then sign in as Rajesh Kumar and approve it. Adeline can open December in the payroll export.

`npm run db:seed` reloads the fictional staff and requests. It refuses to run when `NODE_ENV=production` unless `SEED_RESET=true`.

## Tests

```bash
npm test
```

The tests cover annual-leave pro-rating and rounding, the sick-leave steps, the shared hospitalisation cap, childcare bands and pro-rating, the inactive childcare draft, crew versus shore policies, public holidays, and the apply, approve, reject, cancel, amend, delegate and export flows. They do not need a database.

## Environment variables

See `.env.example` for the full list.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `AUTH_SECRET` | Auth.js session secret |
| `AUTH_URL` | Public URL of this app |
| `DEMO_LOGIN` | `true` shows demo accounts on the sign-in page. Set `false` for a real deployment |
| `AUTH_MICROSOFT_ENTRA_ID_ID` | Entra application (client) id |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | Entra client secret |
| `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | `https://login.microsoftonline.com/{tenant-id}/v2.0` |
| `EMAIL_PROVIDER` | `log`, `smtp` or `graph` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` | SMTP notifications and magic links |
| `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_SENDER` | Microsoft Graph `Mail.Send` |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | S3-compatible file storage. Empty bucket uses local disk |
| `CRON_SECRET` | Bearer token for `/api/cron/daily` |

Do not commit `.env`. The demo password is a fictional shared password for the seeded staff, not a production credential.

## Deploy on Vercel

1. Create a Postgres database in Singapore if you can (Neon or Supabase both work; pick the Singapore region when the host offers it).
2. Import this repository in Vercel and set the environment variables above. `DEMO_LOGIN` should be `false`. Generate a new `AUTH_SECRET`.
3. Set `S3_BUCKET` to a private bucket (Vercel Blob via the S3-compatible endpoint, Cloudflare R2, or AWS S3 in `ap-southeast-1`). Local disk does not persist on Vercel.
4. The build runs `prisma generate` and `next build`. After the first deploy, run `npx prisma migrate deploy` against `DATABASE_URL`, then `npm run db:seed` once if you want the fictional staff. For real staff, use the CSV import instead of the seed.
5. In Microsoft Entra, register an app with redirect URI `https://<your-domain>/api/auth/callback/microsoft-entra-id`. Put the client id, secret and issuer in the environment. Only emails that already exist as employees can sign in.
6. For Graph mail, grant the app `Mail.Send` (application permission) and admin consent. `GRAPH_SENDER` is the mailbox that sends the mail.
7. Set `CRON_SECRET`. `vercel.json` calls `/api/cron/daily` once a day to delete expired medical files and remind approvers about overdue requests.

## Employee CSV

HR can import a file from the HR page. The header is in `public/employee-import-template.csv`.

`employee_id,email,name,short_name,title,role,category,group,joined_on,approver_id,work_pattern,employment_act_covered,policy_group,child_name,child_dob,child_citizen,al_carry_days,al_carry_year,password`

`role` is `EMPLOYEE`, `MANAGER` or `HR_ADMIN`. `category` is `SHORE` or `CREW`. `work_pattern` is `FIVE_DAY` or `SIX_DAY`. Leave `password` blank unless you want a temporary password.

## Out of scope

These were in the longer plan and are not in this app:

- A native iOS or Android app, offline queue, or SMS one-time passwords. The site is usable on a phone browser.
- Push notifications, approval by replying to an email, and Outlook calendar sync.
- A direct payroll or CPF API. The payroll CSV is the hand-off. Payroll still submits CPF.
- Minimum-manning warnings and a full crew rotation planner.
- Leave liability for finance, and automated filing to the Government-Paid Leave portal. The claim pack is a CSV for HR to key in.
- Penetration testing, a breach-notification runbook, and hosting guarantees. Those stay with the operator.

## Assumptions HR should confirm

- Crew contract day counts are seeded to the same numbers as the shore MOM scale so the sample balances match the prototype. They are stored as a separate policy and are not marked for government reimbursement.
- Childcare for a non-citizen child, and the announced 8/10/12-day scale, follow the public descriptions as at 17 November 2026. The new scale is a draft dated 1 July 2027 and is not applied.
- One month of service is reduced for every 22 approved unpaid working days (shore) or 26 (crew).
- Carry-forward is capped at 5 days and must be used by 31 March 2027. Carried days do not cover leave that starts after that date.
- Medical files are kept for two years after the leave end date.
- Public holidays are the 2026 and 2027 MOM dates used in the prototype, including Monday observances when the holiday falls on Sunday.
