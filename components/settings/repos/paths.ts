/**
 * Collapse an absolute path under the server's `$HOME` to `~/…` for display
 * only. Paths outside that home (e.g. `/Users/Shared/…`) are shown verbatim.
 */
export const tildePath = (absolutePath: string, homeDir: string): string => {
  if (!homeDir) return absolutePath;
  const home = homeDir.endsWith("/") ? homeDir.slice(0, -1) : homeDir;
  if (absolutePath === home) return "~";
  const prefix = `${home}/`;
  if (absolutePath.startsWith(prefix)) {
    return `~/${absolutePath.slice(prefix.length)}`;
  }
  return absolutePath;
};
