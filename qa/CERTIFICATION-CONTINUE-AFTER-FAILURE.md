# Certification continuation policy

Mandatory certification stages record their own PASS/FAIL/BLOCKED result. A failure in one stage does not terminate the run when a later stage has sufficient prerequisites to execute.

A later stage that genuinely depends on a missing failed-stage artifact must be reported as BLOCKED/NOT_PROVEN with the dependency recorded.

Continuation never overrides the final release gate: any mandatory FAIL or unresolved prerequisite keeps the overall certification at HOLD.
