/** Checks on other processes by PID. */

/**
 * True only when no process has `pid`: `process.kill(pid, 0)` throws ESRCH.
 * A live process, a process of another user (EPERM), and every other error
 * give false, so a caller that removes the files of an exited process keeps
 * them when it is not sure.
 */
export function processExited(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (cause) {
    return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ESRCH";
  }
}
