# Process

## Feature Development Process

The feature was developed using the capstone workflow:

1. Explore the existing OrderFlow codebase.
2. Define the feature and acceptance criteria in `SPEC.md`.
3. Write tests before implementation.
4. Implement the feature.
5. Review the implementation with the standing SPECS reviewer.
6. Use a stricter review when the initial review passed.
7. Delegate reviewer findings to a worker rather than fixing them directly in the orchestration context.
8. Re-run the relevant tests and reviewer after each fix.
9. Run the test auditor against the completed test suite.
10. Fix substantive test-coverage findings through a worker.
11. Re-run the test auditor.
12. Perform the final review and test run.

## Important Prompts

The important prompts used during the process included:

* the initial feature/SPEC planning prompt;
* the initial SPECS review;
* the stricter SPECS review after the initial PASS;
* the worker delegation for the `shippingState` validation issue;
* the third SPECS review after the fix;
* the initial test-auditor review;
* the worker delegation for the missing test coverage;
* the follow-up test-auditor review.

The stricter SPECS review prompt specifically asked the reviewer to check:

* whether every untrusted field was validated;
* whether malformed quantities could reach the service;
* whether validation occurred before `createOrder`;
* whether invalid requests could trigger database or product lookups;
* whether validation responses exposed unnecessary internal details;
* whether unnecessary abstractions were introduced;
* whether unrelated modifications were present.

This stricter prompt was important because the initial review had already returned PASS.

## What Claude Got Wrong

The most important implementation issue caught by the review was a JavaScript type-coercion bug in `shippingState` validation.

The initial validation used a regular expression check that did not first require `shippingState` to be a string. Because `RegExp.prototype.test()` coerces its argument to a string, a value such as:

```js
shippingState: ["CA"]
```

could incorrectly pass the two-letter regular-expression check.

The value was also truthy, so it could bypass the fallback expression and reach `createOrder`. This meant malformed input could reach downstream database/product lookup logic and eventually produce an error instead of the required validation response.

The first SPECS review did not catch this issue.

The stricter second review deliberately examined coercion and malformed input and caught it. The issue was then fixed by adding an explicit string-type check before the regular expression validation.

This was a useful example of why an initial PASS was not treated as sufficient evidence by itself.

## What the Test Auditor Caught

The test suite initially passed, but the first test-auditor review identified gaps that were not exposed by the existing tests.

The most important missing cases were:

* multiple validation violations occurring in one request and being accumulated rather than failing fast;
* an empty-string `productId`, which exercises a different validation branch from a missing `productId`.

These cases were added before the final test-auditor PASS.

The final test count increased from **61 to 63 tests**.

## How Findings Were Fixed

Reviewer findings were not silently fixed in the main orchestration context.

For the SPECS review failure, the finding was explicitly provided to a worker with instructions to:

* read `SPEC.md`;
* inspect the current implementation;
* fix only the reported issue;
* preserve existing tests;
* avoid unrelated changes;
* run `npm test`.

The worker made a one-line production change and confirmed that the existing 61 tests still passed.

For the test-auditor failure, the two substantive test gaps were similarly delegated to a worker. The worker added the missing tests without changing production code and confirmed that the suite passed with 63 tests.

The low-severity findings were intentionally left unchanged because they were not required to satisfy the scoped feature and fixing them would have expanded the change unnecessarily.

## Single-Agent vs. Orchestration Judgment

The orchestration approach was useful for this feature because the implementation contained both validation/security concerns and test-coverage requirements.

A single implementation pass initially appeared complete and received a SPECS PASS. However, a stricter independent review discovered a real input-validation vulnerability involving JavaScript type coercion.

The standing reviewer/worker workflow made it possible to:

* challenge an initial PASS;
* identify a concrete implementation flaw;
* delegate the correction;
* independently verify the correction;
* audit the tests separately;
* identify missing coverage;
* delegate the test additions;
* independently verify the final test suite.

For this feature, the main value of orchestration was therefore not simply parallel work. It was the use of independent review gates to challenge the implementation and verify fixes.

## Final Evidence

The final workflow produced the following evidence:

* `SPEC.md` was created before implementation.
* The implementation was reviewed by the standing SPECS reviewer.
* A stricter second review produced a genuine **FAIL**.
* The identified production bug was fixed by a worker.
* A subsequent SPECS review returned **PASS**.
* The test auditor produced a genuine **FAIL** for missing coverage.
* The substantive test gaps were fixed by a worker.
* A subsequent test-auditor review returned **PASS**.
* The final reported test result was **8 suites / 63 tests passing**.
* The final production-code fix was limited to the reported validation issue.
* The test additions were limited to the reported coverage gaps.

The review process therefore provided concrete evidence that both the implementation and its tests were independently challenged rather than simply accepting the first successful test run.
