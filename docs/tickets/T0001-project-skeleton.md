# T0001 — Project Skeleton

Status: Ready

## Outcome

A minimal application shell can be installed, started locally, tested, and
built successfully.

## Reason

All future work depends on having a stable development foundation.

## Dependencies

None.

## Preconditions

- Product technology choices have been approved.
- The repository contains no conflicting application scaffold.

## Allowed scope

- `package.json`
- package-manager lockfile
- build-tool configuration
- TypeScript configuration
- lint and formatting configuration
- `src/`
- `public/`
- test configuration
- setup sections of `README.md`

## Protected areas

- `docs/PRODUCT.md`
- Fundamental architecture decisions not required for the skeleton
- Any future feature implementation

## Requirements

- Create the approved application scaffold.
- Enable strict TypeScript.
- Add development, build, lint, type-check, and test scripts.
- Render a minimal application shell.
- Include one basic automated test.
- Document setup and execution commands in `README.md`.

## Non-goals

- Authentication
- Persistence
- API integration
- Domain-specific models
- Production deployment
- Final visual design
- Any feature scheduled after T0001

## Interfaces affected

None.

## Acceptance criteria

- Dependency installation succeeds.
- The development server starts.
- The application renders without a console error.
- Lint succeeds.
- Type checking succeeds.
- Tests succeed.
- Production build succeeds.
- No future feature is implemented.

## Automated verification

Run the commands defined by the chosen package manager for:

- lint
- type checking
- tests
- production build

## Manual verification

1. Install dependencies.
2. Start the development server.
3. Open the displayed local URL.
4. Confirm that the application shell appears.
5. Confirm there are no browser-console errors.
6. Stop the development server.
7. Run the production build.

## Documentation required

- Update setup commands in `README.md`.
- Do not mark the ticket Done until manual verification is accepted.

## Rollback

Revert the ticket commit or delete the ticket branch.
