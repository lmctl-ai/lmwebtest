# Case study: neochart integration testing

Integration testing of neochart.com demonstrates a lightweight testing architecture separating interactive browser exploration, test orchestration, and Lexbor DOM extraction into three specialized tools.

## Testing goal

The objective was to construct a repeatable, fast, and stable command line integration test for neochart.com, which redirects to the primary domain at https://www.neochart.com/. The test verifies HTTP routing, document titles, brand headings, search call to action forms, core legal corpora navigation links, live link resolution, and secondary linked page content.

## Three tool workflow split

Rather than relying on a heavy browser automation suite for assertions, the architecture divides the problem into three distinct roles.

Interactive exploration is handled by playwright-cli. The operator uses it interactively to discover routes, inspect the rendered accessibility tree, discover selectors, and observe client-side dynamic behaviors.

Test orchestration and assertions are handled by lmscript. The automation interpreter coordinates HTTP fetching, launches DOM extraction, inspects extracted findings, evaluates assertions, and handles exit codes.

DOM parsing and element extraction are handled by lmhtml. The native host embeds Lexbor to parse raw HTML documents into HTML5 document object models, query elements using CSS selectors, and export structured JSON findings.

## Team workflow

The project followed a team workflow coordinated through language model control sessions. The Lead agent defined operator intent, requirements, and environment constraints. The Coder agent executed exploration, built host binaries, authored scripts, and documented findings. Two independent reviewers analyzed the implementation and aligned on high-severity findings regarding stale files, false passes, portability, and failure reporting, which were subsequently resolved.

## Site findings

Exploration revealed that the apex domain https://neochart.com issues an HTTP 301 redirect to https://www.neochart.com/.

The homepage presents a semantic masthead with brand title neochart and tagline a free legal document library. A prominent search bar provides a search role form targeting the /search/ path with an input named q. A navigation grid lists twelve life-event topics such as housing, debt, and family. The library browsing section provides stable links to the United States Code, United States Constitution, Texas Statutes, and Case Law. The footer provides a link to an about and provenance page.

The linked about page provides provenance details regarding primary law sources including the Caselaw Access Project, govinfo.gov, Texas Legislature statutes, and National Archives records.

## Tool gotchas encountered

Three notable tool behaviors required adjustments during implementation.

First, playwright-cli defaults to looking for Google Chrome at /opt/google/chrome/chrome rather than a bundled browser. In headless server environments, running playwright-cli install-browser chromium and explicitly supplying the chromium browser option is required.

Second, the dependency synchronization script in lmhtml is named sync-lexbor.sh rather than sync-deps.sh.

Third, the test suites adopt latest versions by design, with breakage fixed forward. When published releases target an older bytecode version than the installed lmscript compiler, the runner builds lmhtml from git main HEAD (about 2.5 minutes cold, 1.9 s warm). Program execution is handled via run_lmcode with the host invocation contract.

## Dynamic search behavior

The search interface on neochart.com renders an initial static shell containing the search form and a searching status indicator. Client-side JavaScript then performs asynchronous queries against an external AWS API gateway endpoint to fetch search results and filter buttons.

Because raw HTML captures do not execute client-side JavaScript, raw DOM assertions can only verify the presence and attributes of the search input and its form action. Testing live dynamic query results requires an active browser runtime.

## Review fixes and lessons learned

The code review identified several subtle failure modes that were corrected in the final suite.

Two reviewers ran break tests and demonstrated that stale work files let individual checks print PASS after a failed fetch or extraction even though the script exit code was already 1. This false pass was fixed by clearing work files at the start of each run, adding -f to curl commands, and aborting early on network capture or extraction failure.

Portability was enhanced by eliminating sibling repository path assumptions and local user directory references. Runner scripts resolve lmhtml strictly through PATH, the LMHTML environment variable, or a local repository cache.

Failure reporting was tightened to display expected versus actual values and exact missing items rather than generic pass phrasing.
