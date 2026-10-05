# Matters for the lawyers to look at

Owner: Anas Sief. Status: open, nothing below has been reviewed by counsel yet.

This document is written by a non-lawyer. Nothing in it is legal advice or a legal
conclusion. It exists so that a lawyer does not have to reverse engineer the product
before answering. It has two parts: the facts about what SafeTurns actually does, and
the open questions grouped by subject.

---

## Part 1. The facts a lawyer needs

### What the product is

SafeTurns is a multi-tenant web and mobile application for companies that transport
students, mostly special needs students, to and from school. It is sold to the transport
company, not to schools and not to parents. Schools and parents get accounts inside the
transport company's tenant.

Six roles: company_admin, school_admin, school_staff, driver, parent, monitor.

There is no public sign up for individual users. Only an admin creates accounts. A
transport company registers itself; everyone else is created by an admin.

Planned first pilot customer: a transport company in the Boston area. Pilot has not
started. No paying customers yet. No signed contracts yet.

### Who the company is

Anas Sief, sole founder, Massachusetts. LLC not yet formed. Operating from
Massachusetts, intending to expand regionally and then nationally.

### What personal data the system holds

About students, who are minors, some of them under 13:
- Full name
- Home address, and additional pickup or drop-off addresses
- School, grade level
- A student ID assigned by the school or the company
- Notes field, free text, which in practice may contain disability or medical
  information even though the system does not ask for it
- Pickup and drop-off times, attendance, no-shows, and a history of every trip

About parents and guardians:
- Name, email, phone, address
- Which students they are linked to
- Requests they submit, for example skipping a pickup

About drivers and monitors, who are employees of the transport company and not of
SafeTurns:
- Name, email, phone, home address
- Driver licence number
- Work sessions, check in and check out times
- Pay rules, pay rates, adjustments, and whether a period has been marked paid

About school staff:
- Name, email, phone, and which students they have been granted access to

### Where the data lives

- Database: Neon, managed PostgreSQL, US region
- Application hosting: Render
- Transactional email: Resend
- Source code: GitHub, currently a public repository
- No analytics tool, no advertising tool, no third party tracking in the app

### What has already been done on security

- Multi-tenant isolation, every query scoped by company or school
- Role based access control, audited once already, a cross-tenant access bug was found
  and fixed
- Passwords hashed, never stored readable; temporary passwords shown once; forced
  password change on first sign in
- Email verification on registration
- Database connection over TLS
- An unverified school cannot claim itself; claims are approved by hand
- A daily unencrypted full database dump to a GitHub artifact was found and switched off

### What has not been done

- No privacy policy, no terms of use, no parent notice, no school data agreement
- No written information security program
- No data retention policy
- No breach notification plan
- No audit log that an admin can read
- No error monitoring and no staging environment, testing happens on production
- No cyber liability insurance, no errors and omissions insurance
- No background check process touching drivers (the transport company does its own)

---

## Part 2. Open questions

### A. Entity, insurance, structure

1. Does an LLC in Massachusetts give adequate protection for a product in this risk
   category, or is something else more appropriate?
2. What insurance is actually needed before the first pilot, and before the first paying
   customer? Specifically errors and omissions, cyber liability, and general liability.
   Schools and transport companies may require proof of coverage in their contracts.
3. Should the pilot run under a written pilot agreement even though no money changes
   hands? What does that agreement need to say about data, liability, and termination?

### B. FERPA

4. SafeTurns is a vendor to transport companies, and the transport companies serve
   schools. Does SafeTurns qualify as a school official with a legitimate educational
   interest under FERPA, and if so, does that relationship need to run directly with the
   school district, or through the transport company?
5. Student names, addresses, schools and attendance records flow through the system. Are
   these education records in this context, given the data originates with the school in
   some cases and with the parent in others?
6. What exactly does a FERPA compliant data agreement with a school district need to
   contain, and should SafeTurns have a standard one ready before approaching schools?

### C. COPPA

7. Some students are under 13. Students themselves have no accounts and never use the
   product. Parents and school staff enter the data. Does COPPA apply at all, and if so,
   who provides the verifiable parental consent, the school or the parent?
8. If a student under 13 is ever given an account in a future version, what changes?

### D. State student privacy laws

9. Massachusetts has no single comprehensive student data privacy statute comparable to
   New York Education Law 2-d or Illinois SOPPA. Is that correct as of today, and what
   actually governs student data held by a school vendor in Massachusetts?
10. Expansion is planned regionally and then nationally. Which states impose the heaviest
    requirements on a school service provider, and which ones should be avoided until the
    company can meet them? New York 2-d, Illinois SOPPA, California SOPIPA and
    Connecticut have been mentioned to us as the strict ones, but this needs checking.
11. Several states require a vendor to sign a specific standard agreement or to be listed
    publicly. Is there a practical checklist for entering a new state?

### E. Massachusetts 201 CMR 17.00, the WISP

12. SafeTurns holds Massachusetts residents' names together with driver licence numbers.
    Our understanding is that this triggers the requirement to maintain a written
    information security program. Is that correct?
13. If so, what does a WISP need to contain for a company of one person, and is there a
    template that is actually adequate rather than decorative?
14. Does holding driver licence numbers at all serve a real purpose? If it does not, is
    deleting that field the cheapest way to reduce obligations? See question 29.

### F. Breach notification

15. Massachusetts chapter 93H sets notification duties. Who must be notified, in what
    time, and in what form, if a breach touches students, parents and drivers across
    several states?
16. Does a breach involving a transport company's data make SafeTurns the notifying party,
    or the transport company, or both? This needs to be settled in the customer contract.
17. What does an adequate incident response plan look like at this size?

### G. Retention and deletion, the blocking question for engineering

A deletion feature is being built. The design is: a company admin closes the account, all
users are signed out immediately, nothing is deleted for a grace period of about 30 days
with an undo link, and then an automatic purge runs with no human review. The purge is
not written yet because the rules below are not settled.

18. Is a 30 day grace period with an undo link defensible, or should it be longer or
    shorter?
19. How long must a terminated student's record be kept, and by whom? The school, the
    transport company, or SafeTurns?
20. A student record belongs to two parties at once, the transport company and the
    school. If the transport company closes its account, what happens to the student
    record that the school still relies on?
21. **Payroll.** Drivers and monitors are employed by the transport company, not by
    SafeTurns. SafeTurns holds their pay rules, rates, worked sessions and paid periods.
    Our assumption is that the FLSA three year retention duty, and any longer
    Massachusetts duty, falls on the transport company as the employer and reaches
    SafeTurns only through contract. Is that assumption right?
22. If SafeTurns does have to keep pay records after an account closes, is it acceptable
    to keep a stripped financial record with no name, no address, no phone and no email,
    linked only to an opaque id, and delete everything identifying? Or does the record
    have to stay identifiable to satisfy the duty?
23. What retention periods should the privacy policy actually state? Engineering cannot
    write the purge job and the policy cannot be published until there are numbers here.
24. Do backups need to be purged too, and on what timeline, or is it acceptable to let
    backups age out on their own schedule?

### H. Individual rights

25. Drivers, monitors and parents did not create their own accounts, an admin created
    them. Can they demand deletion of their own data independently of the company they
    work for or whose service they use? Under which state laws?
26. What is the correct answer when a driver asks to be deleted but the transport company
    needs the pay history? A request inbox is planned so these can be handled, but we need
    to know what the answer is supposed to be.
27. Do access requests, where a person asks for a copy of everything held about them,
    apply here, and what is the response window?

### I. Data minimisation

28. The student notes field is free text. Staff can and probably will type medical and
    disability information into it. Does accepting that field make SafeTurns a holder of
    health data, and does that change the obligations? Should the field be restricted,
    labelled, or removed?
29. Is the driver licence number needed? Removing it may remove the WISP trigger in
    question 12. What is lost legally or operationally by dropping it?
30. The system records a child's home address, their school and their exact pickup time
    every day. Is there anything specific that should be done about that combination
    beyond ordinary security?

### J. Contracts and terms

31. Terms of use and privacy policy need drafting. Both have to be real, not templates,
    because of the child data.
32. A customer agreement with the transport company is needed. Limitation of liability is
    the critical clause. If the app shows the wrong address or the wrong time and a
    special needs child is dropped at the wrong place, what is the realistic exposure and
    what can be limited by contract?
33. A data processing agreement or school data agreement is needed, because schools will
    ask before signing.
34. A parent facing notice is needed. Who delivers it, SafeTurns or the school?
35. A subprocessor list naming Neon, Render and Resend will be requested by schools. Does
    it have a required form, and does adding a subprocessor later require notice?

### K. Other

36. The mobile app is distributed through the Apple and Google stores. Apple requires
    in-app account deletion for apps that let users create accounts. SafeTurns does not
    let users create their own accounts. Does the requirement still apply?
37. Accessibility. School districts frequently require WCAG conformance and public
    entities are covered by ADA and Section 508 obligations. Does that reach a vendor
    like SafeTurns, and at what level?
38. If SMS notifications are added later, what does TCPA consent require, given the
    recipients are parents whose numbers were entered by somebody else?
39. The source code repository is currently public. It contains no credentials, but it
    does describe the access control rules and the infrastructure. Is there a reason to
    make it private beyond ordinary commercial sense?
40. The name SafeTurns and the domain safeturns.com. Trademark search and registration,
    and whether anything about the name creates a problem in this sector.

---

## What is most urgent

In our own judgement, not counsel's:

1. Retention periods (G), because engineering is blocked on them and the privacy policy
   cannot be written without them.
2. Privacy policy, terms of use, and the school data agreement (J), because the pilot
   cannot responsibly start without them.
3. The WISP (E), because if it is required it is required now, not later.
4. Insurance (A), before any real student data from a real customer enters the system.

Everything else can follow.
