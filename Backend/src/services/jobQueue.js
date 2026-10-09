/** Tiny in-process FIFO queue with bounded concurrency. Jobs are idempotent; startup recovery re-enqueues unfinished documents. */
export function createQueue({ concurrency = 2, logger }) {
  const pending = [];
  let active = 0;
  const waiters = [];
  const settleIdle = () => {
    if (!active && !pending.length) waiters.splice(0).forEach((r) => r());
  };
  function pump() {
    while (active < concurrency && pending.length) {
      const job = pending.shift();
      active++;
      Promise.resolve()
        .then(job)
        .catch((err) => logger?.error({ err }, 'background job crashed'))
        .finally(() => { active--; pump(); settleIdle(); });
    }
  }
  return {
    enqueue(job) { pending.push(job); pump(); },
    size: () => pending.length + active,
    idle: () => (!active && !pending.length ? Promise.resolve() : new Promise((r) => waiters.push(r))),
  };
}
