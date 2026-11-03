Snapshot of https://github.com/lmctl-ai/lmcode-js at 6bf09cd1073c8fb6d0e8077254ad50256d722040 (src/, std/, stdlib/ and package.json, unmodified). Refresh by copying those paths from a newer checkout.
One local change: src/std/index.mjs imports lmcode-std.schema.json instead of reading it with readFileSync, so `bun build --compile` can embed it.
