# Architecture decision records

Each record captures one decision: the context, what we chose, what we turned
down, and the consequences. Records are never edited after they're accepted;
a later record supersedes an earlier one instead.

| #                                       | Decision                                         | Status                                        |
| --------------------------------------- | ------------------------------------------------ | --------------------------------------------- |
| [0001](0001-monorepo.md)                | One monorepo with pnpm workspaces and Turborepo  | Accepted                                      |
| [0002](0002-crypto-format.md)           | The pvf1 crypto format                           | Accepted                                      |
| [0003](0003-storage-modes.md)           | Three storage modes with identical crypto        | Accepted                                      |
| [0004](0004-server-stack.md)            | Java 21 + Spring Boot server, OpenAPI spec-first | Accepted                                      |
| [0005](0005-design-system.md)           | Own design system, self-hosted fonts             | Accepted; visual direction superseded by 0006 |
| [0006](0006-tumbler-visual-language.md) | "Tumbler": the vault as a precision instrument   | Accepted                                      |
