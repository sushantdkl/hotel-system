# Raithane Daure Chulo Documentation

This directory is the documentation hub for the Raithane Daure Chulo restaurant website and point-of-sale system. The application is built with Next.js 16 and React 19, uses PostgreSQL in production, and can fall back to SQLite for local development.

## Start here

| Document | Purpose |
|---|---|
| [PRD](PRD.md) | Product goals, users, scope, and success criteria |
| [TRD](TRD.md) | Architecture, runtime, modules, and engineering constraints |
| [App flow](APP_FLOW.md) | Customer, administrator, order, and payment journeys |
| [Business logic](BUSINESS_LOGIC.md) | Domain rules and important invariants |
| [API documentation](API_DOCUMENTATION.md) | API conventions and endpoint catalog |
| [Database schema](DATABASE_SCHEMA.md) | Data model, table groups, and migration workflow |
| [Security](SECURITY.md) | Authentication, authorization, secrets, and hardening |
| [Deployment guide](DEPLOYMENT_GUIDE.md) | Local and cPanel/PostgreSQL deployment |
| [QA production readiness guide](QA_CHECKLIST.md) | Full release test plan, evidence rules, reconciliation, and go/no-go sign-off |
| [Launch checklist](LAUNCH_CHECKLIST.md) | Go-live and rollback checklist |
| [Future roadmap](FUTURE_ROADMAP.md) | Prioritized improvements, not delivery promises |

## Existing operational records

- [Production verification](PRODUCTION_VERIFICATION.md)
- [Production audit](PRODUCTION_AUDIT.md)
- [Final production audit](FINAL_PRODUCTION_AUDIT.md)
- [cPanel deployment notes](CPANEL_DEPLOYMENT.md)
- [Production install source of truth](../deploy/INSTALL.md)
- [System overview](../SYSTEM_OVERVIEW.md)

## Documentation rules

- Update the relevant document in the same change as code, schema, configuration, or workflow changes.
- Treat `migrations/` and `deploy/production_schema.sql` as the database implementation sources of truth.
- Treat `app/api/**/route.js` as the API implementation source of truth.
- Never place passwords, tokens, production URLs, customer data, or database dumps in documentation.
- Dates use ISO format (`YYYY-MM-DD`), amounts are stored as numeric values, and the application displays Nepalese rupees.

Last reviewed: 2026-08-04.
