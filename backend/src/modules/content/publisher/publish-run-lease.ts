import { PublishRunStatus, type PublishRun } from "@prisma/client";

/**
 * How often the executor says it is still carrying out a run.
 *
 * A job that is killed writes nothing on its way out: a task timeout, an
 * out-of-memory kill or a cancelled execution ends the process between two
 * statements. Its run would stay `RUNNING`, and the partial unique index over
 * the live statuses would then refuse every later publish and rollback.
 * The heartbeat is how a run can tell a slow job from a dead one (#452).
 */
export const PUBLISH_RUN_HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * How long a running run may go unheard before it counts as abandoned.
 *
 * Ten missed heartbeats. Nothing the executor does blocks its event loop for
 * anywhere near that long: the build is a child process, and the long
 * transaction is network I/O. A run past this lease has lost its executor,
 * and the console may give it up. Giving up is safe even when the job is
 * somehow still alive. The pointer lock refuses a second release while the
 * first one's transaction is open, and every write the executor makes to its
 * run is conditional on the run still being `RUNNING`.
 */
export const PUBLISH_RUN_LEASE_MS = 5 * 60_000;

/** When the executor was last heard from, for a run it has claimed. */
export function lastHeardFrom(run: PublishRun): Date | null {
  // A run claimed before the heartbeat existed has no beat. Its start is the
  // last time anything is known to have been alive.
  return run.heartbeatAt ?? run.startedAt;
}

/**
 * Whether a run is `RUNNING` with nobody carrying it out any more.
 *
 * Derived at read time rather than stored: it is a statement about now, and
 * a stored flag would be stale by the next poll.
 */
export function isExecutorLost(run: PublishRun, now: Date): boolean {
  if (run.status !== PublishRunStatus.RUNNING) {
    return false;
  }
  const heard = lastHeardFrom(run);
  return (
    heard === null || now.getTime() - heard.getTime() > PUBLISH_RUN_LEASE_MS
  );
}
