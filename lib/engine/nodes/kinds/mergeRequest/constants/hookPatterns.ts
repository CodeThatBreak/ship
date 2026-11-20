/** Push-rejection signatures that mark an MR-creation failure as repairable code state. */
export const HOOK_PATTERNS = [
  /pre-receive/i,
  /pre-push/i,
  /hook declined/i,
  /push declined/i,
  /rejected.*hook/i,
  /hook.*reject/i,
  /! \[remote rejected\]/i,
  /error: failed to push some refs/i,
];
