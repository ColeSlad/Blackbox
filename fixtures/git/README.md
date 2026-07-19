# Git fixtures

The `@blackbox/git` integration tests construct disposable native-Git
repositories from deterministic file contents, author metadata, and timestamps.
They do not commit generated object databases because Git repository internals
vary by object format and installed Git implementation.
