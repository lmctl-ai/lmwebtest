# Adding a check to an integration test

Adding a new assertion to the neochart integration suite requires updating DOM element extraction and evaluating the finding in the assertion loop.

## Overview of the check lifecycle

Every assertion follows a four step flow: network capture, DOM extraction, report parsing, and condition evaluation. Tests avoid coupling assertion logic directly to network calls or raw markup parsing.

## Step one: Capture the document

If the element lives on an existing captured page like the homepage or about page, no extra network step is needed. If the element lives on a new page, invoke curl using the system function in neochart.lms with timeout and retry flags.

```
let fetch_res = system(["curl", "-fsSL", "--max-time", "20", "--retry", "2", "-w", "%{http_code}", "https://www.neochart.com/constitution/index.html", "-o", "work/constitution.html"]);
```

Verify that the system call returned exit code zero, did not time out, returned HTTP 200, and created the target file.

## Step two: Extract DOM elements with Lexbor

Locate the embedded lmcode block in the neochart script. Use the Lexbor document object to query target elements by selector or built-in methods.

```
let doc = html.load("work/constitution.html");
let headings = doc.select("main h2");
for (i in range(0, headings.len())) {
  let heading = headings.at(i);
  report.add("constitution_h2", "constitution.html", 0, heading.text());
}
```

The report.add call records the finding kind, source file, line number, and text payload into the structured report.

## Step three: Collect report findings

In the lmscript section following extraction, iterate over the findings array parsed from work/extracted.json.

```
let constitution_headings = [];
for (k in range(0, findings.len())) {
  let item = findings.get(k, {});
  if (item.get("kind", "") == "constitution_h2") {
    push(constitution_headings, item.get("message", ""));
  }
}
```

## Step four: Assert with the check helper

Invoke the check helper with a boolean condition, a concise test title, and diagnostic details formatting expected versus actual values.

```
let has_amendments = contains(constitution_headings, "Amendments");
check(has_amendments,
  "Constitution Amendments Section",
  has_amendments ? "found Amendments heading" : "expected Amendments heading in constitution.html");
```

The check function records pass and fail counts and prints formatted output. The summary block at the end of the script inspects the failure count and exits with code 1 if any check failed.
