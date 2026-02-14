/** Resolved home directory — single source of truth for `~/.ralph/*` paths. */
export const homeDir: string = process.env.HOME ?? process.env.USERPROFILE ?? "~"
