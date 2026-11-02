# Case study: mock web application integration testing

Integration testing of an interactive mock web application demonstrates a fully offline and deterministic testing architecture combining lmmock, lmcode SAM handlers, lmscript, and lmhtml.

## Testing goal

The objective was to construct an offline integration test suitable for push and pull request continuous integration workflows. The test exercises an interactive web application that requires session cookie authentication, protects routes from unauthenticated access, provides stateful counters, and contains interactive buttons.

## Architecture and tool separation

The testing architecture decouples the mock web service from the test client and DOM extraction engine.

The web application runs on lmmock, a loopback HTTP host written in Go. Service behavior is authored as annotated lmcode functions implementing the Handler SAM interface. The host maps routes to annotations, provides an isolated Exchange context per request, and stores server state across requests.

The test driver is written in lmscript. It executes under lmmock exec, which allocates a dynamic loopback address, sets the LMMOCK_URL environment variable, and forwards child process exit codes.

The test driver uses curl with a cookie jar to execute HTTP requests and relies on lmhtml with embedded Lexbor to inspect raw HTML responses.

## Driving interactions from the DOM

Rather than hardcoding endpoint URLs and button identifiers, the test inspects the rendered markup to discover interaction targets dynamically.

On the login page, lmhtml extracts the form action, HTTP method, input element names, and submit button identifier. The test driver verifies that the form contract matches expectations and then submits credentials directly to the discovered form action.

On the authenticated dashboard, lmhtml extracts the username display, the counter value, and the form action paths associated with specific button identifiers. The test driver clicks the increment and reset buttons by submitting POST requests to the exact action paths extracted from the document.

## Authentication and session rules

The mock application enforces standard web authentication contracts across multiple endpoints.

Unauthenticated requests to the dashboard return an HTTP 303 redirect to the login route.

Submitting invalid credentials returns HTTP 401 Unauthorized with an HTML page containing an error element with the text Invalid username or password, while issuing no session cookie.

Submitting valid credentials returns an HTTP 303 redirect to the dashboard along with an HttpOnly session cookie containing a token generated via random_token.

Protected action routes for clicking the counter and resetting state verify the session cookie from request headers. Unauthenticated requests to these action routes return HTTP 401 Unauthorized.

The logout route invalidates the session token in server memory, clears the cookie header, and redirects to login. Subsequent attempts to access protected routes using the previous cookie are rejected.

The test begins with an explicit reset of the counter to ensure state-order independence regardless of previous runs.

## Problems encountered and solutions

Three technical issues were encountered and resolved during implementation.

First, executing curl with both the -I flag and the -d flag caused curl to send an HTTP HEAD request instead of POST, which bypassed the POST handler and prevented cookie storage. This was resolved by removing the -I flag on POST requests and capturing status codes via formatted write-out options.

Second, lmmock requires compiled bytecode to match the exact SHA256 checksum of its embedded host schema. Bytecode compiled against older or mismatched schema files was rejected at startup. This was resolved by exporting the schema directly from the lmmock binary using the schema subcommand.

Third, runtime compatibility was confirmed: lmmock and lmhtml binaries and the installed lmscript compiler use latest versions by design, where breakage is fixed forward. DSL bytecode version 6 is executed natively across the host tools. The entire 26-check suite runs warm in approximately 1.3 s without requiring host recompilation.
