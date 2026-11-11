# Gold Work Studio — working contract

## Current user task (2026-11-09)

Latest explicit user instruction (2026-11-11) supersedes the former execution ban below: implement universal historical/biographical search-plan grounding and early candidate disambiguation; fix bounded downloads, incomplete visual JSON and route quotation evidence. Codex now MUST run appropriate builds, targeted tests, local checks and bounded live checks on saved problem scenes before integrated production continuation. Preserve existing paid receipts/uncertain-submission guards, accepted media, narration, queue and projects; do not resubmit completed Lumean orders. Coordinator owns TASK/STATUS and live-production orchestration. Workers may run their scoped local tests; coordinate live paid operations first to avoid concurrent duplicate work. Work in separate trees; never change the handed candidate or profile unintentionally.

Read `TASK.md` and `STATUS.md` at the start of work and after context recovery. For this local migration, the coordinator's canonical live copies are `E:\GoldWorkStudio\TASK.md` and `E:\GoldWorkStudio\STATUS.md` when present; repository copies record the handoff snapshot. The current user instruction in TASK.md overrides all older execution/testing guidance below: Codex and every agent must not run tests, checks, lint/typecheck, builds/packages, the app/dev/preview, provider probes, generation/search/render/export, or benchmarks, and must not create new tests. Use file operations, Git and static source/diff review only; the user builds, runs and accepts each version. The coordinator alone updates TASK.md/STATUS.md. Do not change a source/profile candidate while the user is checking it.

## Scope and source of truth

This is a local Windows Electron/TypeScript application. Current user decisions override this document. Product requirements are in `GWS_VIDEO_WORKFLOW_SPEC.md`; priorities and acceptance status are in `ROADMAP.md`. Read the spec once for a workflow change and only the relevant roadmap sections. Historical handoffs are background, not proof that code or live services work.

The current user-requested priority is Stock Documentary, including a full editable multitrack timeline, motion templates, transitions and SFX. Preserve AI Story and its existing projects. There are two immutable channel directions; Mixed is legacy compatibility only. Do not add SaaS, roles, registration, licensing/activation keys, a backend service or music unless requested. Existing external-provider credentials remain necessary integrations, not a reason to build an account system for this private app.

## Navigate and preserve the workspace

- Start code work with `git status --short`, a scoped diff/stat, and targeted `rg`. The checkout contains substantial user changes and untracked implementation files; preserve them. Do not reset, clean, switch checkouts, or treat untracked files as disposable.
- `apps/desktop/src`: Electron main/IPC, service adapters, queue, storage, FFmpeg. `apps/renderer/src`: React workflow/UI. `packages/shared/src`: serialized types and shared timing contracts. `packages/core/src`: project/domain behavior. `packages/remotion-video/src`: compositions and visual timeline.
- Exclude `node_modules`, `dist`, captures, media binaries and large logs from broad searches. Inspect explicit media/log excerpts when necessary. Never print credentials, cookies, signed media URLs, or full provider settings.
- Use the existing Node/pnpm/TypeScript stack and lockfile. Avoid dependency upgrades unrelated to the task. Use `apply_patch` for source edits.

## Implement and verify

- Prefer simple, readable code for this small local app. Add abstractions, security machinery, or extra layers only to solve a concrete requirement or observed failure; do not build infrastructure for hypothetical scale. Keep necessary protections for user files and uncertain paid submissions.
- User preference reaffirmed (2026-10-19): this software is for only a couple of people. Keep implementations small, direct, and easy to understand; do not add complex frameworks, generic engines, or extra validation stages to the accepted footage workflow. Clarify unresolved editing behavior before implementing it. The approved editable-music and reference-montage request is recorded in `work/montage-reference-20261019/request.json`; distinguish approved requirements from its open questions.
- User preference (2026-09-16): prioritize useful features, then build/check affected types and perform one brief startup/changed-path check. Show a coherent working increment to the user, who will manually test script splitting, search, assembly, timeline, transitions and sound. Use that feedback for the next fixes; do not delay delivery for broad automated coverage.
- Investigate the failing user path, fix the cause, then test that path. For multi-step implementation, keep a short plan and continue through its acceptance criteria without asking to continue after each increment.
- Ready scripts remain exact original text. Voice calibration precedes planning; normal AI frames target about 5 seconds, ordinarily at most 8, absolutely at most 9. Do not hide timing errors by truncating narration.
- Keep cut/dissolve/dip-to-black and none/alternate/smart motion distinct. AI Story has no automatic infographic/title overlays. Heroes are channel-scoped, optional, reusable, and explicitly confirmed when versioned.
- Preserve queue checkpoints and known remote-job IDs. Never blindly retry an uncertain paid submission. Graceful fallback must remain visible to the user and must not fabricate successful generation.
- Use a narrow test for a concrete regression or changed storage/paid-job boundary that a brief manual check would miss. Check the changed UI path once when needed. Do not add tests that mirror the implementation or introduce a new test framework without a concrete need. Do not dismiss a failing smoke test as obsolete without evidence.
- Core and shared packages export `dist`; build changed libraries before consumers and tests. Core tests run from `dist`, so green tests without a current core build are not acceptance evidence.
- Do not run the full local gate or hundreds of tests by default; run the full suite only when the user explicitly requests it. Do not repeatedly rebuild/restart the app or render long videos after every change. Repeat only a check affected by later edits or a newly observed failure. Preserve existing test files. No build/tests/app restart for documentation-only changes.
- Distinguish unit/mocked/local-media/live-provider/portable evidence. Never mark a live Flow or long-video requirement done based only on mocks. Reuse existing live-test authorization; keep paid tests bounded and checkpoints intact.
- For visual acceptance, inspect actual rendered frames and audio/video timing. Semantic smart motion is not face recognition. A successful build is not visual-quality acceptance.

## Commands (PowerShell, repository root)

- Dependencies, only if missing: `pnpm install --frozen-lockfile`.
- Development: `pnpm dev`. Check existing app/dev-server processes first; do not launch duplicates or kill unrelated sessions. Restart the app after main/preload changes and verify build identity.
- Fast type gate: `powershell -NoProfile -File scripts/verify-local.ps1`.
- Full local gate, only on explicit user request: `powershell -NoProfile -File scripts/verify-local.ps1 -Full` (build → tests → local FFmpeg pipeline smoke → diff check). This is not the normal delivery requirement.
- Show the gate without running it: `powershell -NoProfile -File scripts/verify-local.ps1 -Full -List`.
- Focused desktop example: `pnpm --filter @gold-work/desktop exec tsx --test src/ready-script.test.ts` (build changed shared/core first).

## Handoff

Keep the final response short: changed behavior, verification, and specific unfinished acceptance criteria. Update roadmap/spec only when behavior or acceptance status changed. Record important unresolved failures with a reproduction so the next turn continues instead of re-auditing everything. Ask only when a missing choice changes scope or existing authority truly does not cover the next action.
