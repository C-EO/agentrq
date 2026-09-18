# Telemetry

> Read before adding a telemetry action — it is four places, or it reads as zero.

Most actions are emitted by the backend right after it does the work, which
makes them self-evidently true. A few happen entirely in the browser and are
*reported* by it instead — the local-AI features, and interface usage
(shortcuts, search, copies, the trajectory view).

- The allowlist in `entity.ClientReportableAction` is the security boundary for
  `POST /api/v1/telemetry`: only names in it may be reported, and the controller
  additionally checks the caller owns the workspace.
- Adding one means four places, or it reads as zero: the `Action` constant and
  its `String()`, the allowlist, the `model.ActionID*` constant (**append only**
  — the value is stored), and the mapping in `controller/telemetry`.
- `frontend/src/composables/useUiTelemetry.js` resolves the workspace from the
  route and **drops the report when there is none**, rather than guessing one.
  Interface counts are therefore actions-with-a-workspace-in-context.
- **Not every action has a workspace, and the machine ones deliberately do
  not.** A machine belongs to an account and runs agents for many workspaces at
  once, so `machine_add`, `machine_remove`, `machine_disable`, `machine_enable`
  and `machine_enrol_code_create` store workspace `0` — they will never appear
  in a *workspace's* stats, only in an account's. The session and terminal
  actions do carry one, because a session knows which workspace it is working
  in. Do not "fix" a zero there by attributing it to whichever workspace
  happens to be open.
- All of the machine actions are **backend-emitted and none is in
  `ClientReportableAction`**, which `telemetry_test.go` enforces by name: the
  server observes every enrolment, delete, session and terminal attach itself,
  so a browser claiming one could invent machines and agent runs that never
  happened.
- The route is rate limited per user. It was raised to 60/minute when interface
  usage was added; ordinary use passes the old ceiling of 10 easily, and being
  short there loses reports silently and starves the local-AI metrics that share
  the bucket.

