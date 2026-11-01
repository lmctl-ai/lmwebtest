# Architectural decisions in web testing

Separating ad-hoc site exploration from repeatable continuous integration assertions isolates exploratory work from stable verification.

## Why curl and lmhtml instead of full browser automation

Running browser drivers like Chromium or WebKit inside automated continuous integration pipelines introduces operational overhead and failure surfaces.

Headless browsers require substantial CPU and memory to initialize a browser context. In contrast, running curl and Lexbor through lmscript executes the entire neochart suite in about 1.9 s when lmhtml is present.

Browser-based test suites frequently suffer from race conditions, layout shifts, font rendering delays, and zombie daemon processes. Parsing raw captured HTML using Lexbor in lmhtml provides deterministic HTML5 document object model tree parsing without timing variability.

Using lightweight CLI tools allows test suites to run on minimal virtual machines without desktop dependencies, display servers, or GPU emulation.

## The proper role of playwright

While full browsers are not needed for routine CI assertion suites, they remain valuable during initial exploration.

The playwright-cli tool enables an engineer or agent to explore an unfamiliar web application interactively. It can open a target site, inspect the live accessibility snapshot, click buttons, fill forms, and trace network requests.

This exploration step identifies routing patterns, semantic selectors, and dynamic behavior before code is written. Once selectors and routes are confirmed, findings are codified into repeatable lmscript tests, and the browser is not needed for routine verification.

## Stability rules for assertions

Integration tests must assert on durable page semantics rather than volatile presentation details.

Tests must verify exact HTTP status codes and redirection targets. For example, testing neochart.com asserts on an exact HTTP 301 redirect to https://www.neochart.com/.

Document titles and primary headings should use exact matching when content is stable. The neochart homepage title is asserted to match neochart — Legal Document Library exactly.

Avoid asserting on dynamic quantities such as search result counts, live citation frequencies, or database update timestamps. These values change as corpus data updates and cause false failures.

Form inputs, action endpoints, and key navigation links should be verified against structural attributes rather than transient DOM positioning. Testing that a search form specifies action /search/ and input name q proves contract compliance regardless of styling updates.
