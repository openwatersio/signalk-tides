# Contributing

Every change follows the org-wide [rigor rules](https://github.com/openwatersio/.github/blob/main/docs/agents/rigor.md). The first of them: when something fails or looks wrong, find the cause and fix it there instead of working around it.

## Releasing

Publishing to npm runs from [release.yml](.github/workflows/release.yml) when a GitHub release is created. A person creates the release by hand: choose or create a `vX.Y.Z` tag, then fill in the title and notes.

Title and notes follow the Open Waters [release notes guidance](https://github.com/openwatersio/.github/blob/main/docs/agents/releases.md#release-notes). Write them for boaters running Signal K, not for developers reading commit subjects:

- Title the release with a short headline of what changed, in sentence case with no period and no version. Patch releases get a headline too. Put a new requirement in the headline, such as "requires Node 24".
- Open the notes with what is new and who it is for. Put breaking changes and upgrade steps first.
- List the changes users will notice, one per bullet, each linking its pull request. Leave out chores, CI changes, and bot dependency bumps unless a runtime dependency change matters to users.
