# AGENTS.md — lmwebtest

Read durable-memory/index.md first: the ownership model, conventions, decisions and release notes (npm-release.md: how a version reaches npm). When you finish work another agent would need to know about, add a note in durable-memory/ and a line in the index in the same commit.

- Tests: `npm test` (Playwright; CI pins lmscript @lmctl-ai/lmctl@0.2.426 for the DSL test), `npm run check`.
- Web DSL: src/dsl/web.js and schema/lmwebtest.dsl.json change together; README "QA helpers" lists the QA methods.
