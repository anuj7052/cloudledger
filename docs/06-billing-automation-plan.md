# Azure Billing automation — implementation plan

Status: **Approved.** Phase 0 (audit) built. Phase 1+ pending. Test mailbox: anuj.singh@foetron.com (until billing@ is created).

Ground rules for every phase:
- Production data is never deleted or rewritten. New features add new tables/columns only.
- Every automatic action is logged in the billing change history.
- Admin-only for anything that changes data or sends mail.
- Each phase ships separately; you approve before the next one starts.
- **No mail is ever sent automatically.** Anything that would go out (reminders,
  approvals, hand-offs) is first saved as a **draft + note**. Management approves
  it in the app, and only then is the mail sent. Without approval the app only
  writes notes.

---

## Phase 0 — Audit trail & audit report (do first, no setup needed)

**Goal:** for every change in Azure Billing, know **who** changed **what**, **when**, and **why**.

Today the app already records who/what/when (before and after values) for
customers, subscriptions, entries, extra charges, tenant bills, services/POs and
deletes — but there is no **reason** and no screen to read it.

What gets built:
1. **"Reason for change" box** on every edit and delete (entries, tenant bills,
   extra charges, subscriptions, customers, POs/BOQs, mapping).
   - Required when **editing or deleting** existing data; optional when creating.
   - Saved with the change.
2. New tab **Azure Billing → Audit log**
   - One row per change: Date & time, User (name + email), Action (created /
     edited / deleted / restored / mail approved), Item (customer → subscription →
     month / invoice), **What changed** (only the fields that changed: old → new,
     e.g. *Distributor amount: 4,977.05 → 5,012.00*), **Reason**.
   - Filters: date range, user, customer, action, item type; search.
   - Click a row → full before/after detail.
3. **Audit report export** (CSV and Excel) for any filter — for monthly review or
   auditors.
4. **History per item:** on any entry / customer / PO, a "History" link shows its
   own changes.
5. Audit rows can never be edited or deleted from the app (append-only), and
   deleting a customer keeps its audit history.
6. Old changes made before this feature show "Reason: not recorded".

Data changes: one new column (`reason`) on the existing change-history table. No
existing data rewritten.

Effort: ~1–2 days. Risk: low.

---

## Phase 1 — Payments due (no setup needed)

**Goal:** see every unpaid amount in one place and mark payments quickly.

What gets built:
1. New tab **Azure Billing → Payments due**
   - Lists every invoice (subscription entries + tenant bills) with a balance due.
   - Columns: Customer, Invoice, Month, Billed, Received, Due, Days overdue, Payment remark.
   - Filters: customer, overdue bucket (0–30 / 31–60 / 60+ days), month.
   - Sorted oldest first. Export CSV.
2. Summary cards: **Total pending**, **Overdue > 30 days**, **Overdue > 60 days**, **Received this month**.
3. **Mark paid** button per row: fills Amount received (full or partial) + Received on date + remark.
4. **Payments due** card on Billing overview (click → opens the list).
5. "Due date" rule: invoice month end + N days (setting, default 30). Optional due date per customer.

Data changes: none to existing rows. One new setting (payment terms days) per customer, default 30.

Effort: ~1–2 days. Risk: low.

---

## Phase 2 — Payment reminders by mail

**Needs from you first:**
- A shared mailbox, e.g. `billing@foetron.com` (M365 admin).
- Entra admin consent for Microsoft Graph **Mail.Send** (application), limited to that mailbox with an Application Access Policy.
- Billing contact email for each customer (Company details).

What gets built:
1. **Daily internal summary** to you: total pending, list of overdue invoices.
   (Internal only; also needs approval to be switched on once.)
2. **Customer reminders — approval first:**
   - The app prepares reminder **drafts** and writes a note ("Reminder drafted for
     ID26FCS0815 — ₹5,855.16 due"). Nothing is sent.
   - Management sees **Reminders waiting for approval**, can edit, approve or
     reject each (or approve all).
   - Only approved reminders are sent. Rejected ones stay as a note with the reason.
   - Settings:
   - First reminder after X days overdue, repeat every Y days (settings).
   - Mail template (editable): invoice no, month, amount due, payment remark.
   - Escalation: after 2nd reminder, CC account manager.
3. Every reminder saved as a note on the invoice ("Reminder sent 12 Nov").
4. **Pause reminders** per invoice (e.g. "customer promised payment").

Effort: ~2 days after setup. Risk: low (start with internal summary only).

---

## Phase 3 — PO / BOQ mail capture

**Needs from you first:** same shared mailbox + **Mail.Read** permission; customer email domains.

What gets built:
1. Background check of the mailbox every 5 minutes (only mails where `billing@` is in To/CC).
2. For each mail:
   - Match customer by sender domain / email / name.
   - Read subject, body and attachments (PDF, Excel) — find PO number, BOQ ref, amount, service, "approved".
   - Save attachments to Blob under the customer's **Services & POs**.
   - Create a PO/BOQ record (status *Planned* until confirmed) and a note: "PO 4500123 received/approved — VM upgrade, ₹1,20,000/month".
3. **Needs review** inbox in the app for anything not matched confidently — you assign customer/subscription with one click. Nothing is auto-attached below a confidence threshold.
4. Dashboard box **"Today — customer communication"**: today's mails, POs and approvals.
5. Invoices received by mail → **Bills & uploads** with amounts read automatically (still "check amounts" before counting).

Effort: ~4–5 days. Risk: medium (needs testing on real mails). Cost: Azure OpenAI ~₹1–3 per mail.

---

## Phase 4 — Subscription request & approval workflow

**Needs from you first:** approval chain (who approves, amount limits), departments and their people. Optional: Teams permission for approval cards.

What gets built:
1. **New request** form: customer, subscription/service, PO, BOQ, expected monthly cost, documents.
2. Status flow: **Draft → Pending approval → Approved / Rejected → In progress (department) → Done**.
3. Approver sees the request in **Approvals** in the app (mail / Teams notice
   to the approver is sent only if you switch it on). Nothing goes to the
   customer or another department until approved.
4. On approval: task to next department with due date; they mark Done.
5. On Done: service becomes **Active** in Services & POs, note created, appears on cost dashboard.
6. Full timeline per request (who did what, when). "My tasks" list per user.

Effort: ~4–6 days. Risk: medium (depends on agreed process).

---

## Phase 5 — Azure activity notes

1. Read Azure Activity Log for mapped subscriptions daily.
2. New resource / scale-up / delete → automatic note on the cost dashboard.
3. "Which PO is this?" — admin links it to a PO/BOQ in one click; unlinked changes are highlighted.

Effort: ~2–3 days. Risk: low (read-only on Azure).

---

## Summary

| Phase | Needs setup | Effort | Value |
|---|---|---|---|
| 0 Audit trail & report | No | 1–2 days | High — know who changed what and why |
| 1 Payments due | No | 1–2 days | High — see pending money now |
| 2 Reminders | Mailbox + Mail.Send | 2 days | High — faster payments |
| 3 PO/BOQ mail capture | Mailbox + Mail.Read | 4–5 days | High — no manual upload |
| 4 Approval workflow | Approval chain | 4–6 days | Medium–High |
| 5 Activity notes | None | 2–3 days | Medium |

## What I need from you
1. Approve this plan (or tell me what to change). Suggested order: **Phase 0 → 1 → 2 → 3 → 4 → 5**.
   Who counts as "management" (which users can approve mails)?
2. For Phase 1: default payment terms (30 days?).
3. Ask M365 admin for the shared mailbox now so Phase 2–3 are not blocked.
4. Start filling customer billing emails.
