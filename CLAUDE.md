@AGENTS.md

# Merge rule: every session follows this

- **Ask about the feature switch before every merge** (Owner, Oct 30, 2026). Before Claude merges a branch, Claude asks the Owner: "Does this need to be behind a feature switch?" Claude gives a recommendation and the reason (for example: a large or risky feature → Yes; a bug fix, a small change or no change a user can see → No). Claude does not merge until the Owner answers. If the answer is No, the change is live for everyone as soon as it merges.
- This repo has no feature switch system yet. If the answer is Yes, tell the Owner that a switch must be built first, and do not merge until the Owner decides how to continue.
