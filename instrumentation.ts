// Next.js 14 instrumentation hook. Runs once at server boot (in the Node
// runtime). We use it to install process-level safety nets and the
// admin-toggled daily AUTO-REFILL scheduler. The scheduler checks app_config
// every 60s; when auto_refill_enabled is on AND the wall clock crosses
// auto_refill_time, it fires runAutoRefill once (deduped by
// auto_refill_last_run) and updates state live so workers see "auto-refill in
// progress" and can't stack a manual refill.
//
// NOTE (build-critical): Next.js compiles this file for BOTH the nodejs and
// edge runtimes. The edge variant cannot resolve node builtins (`fs`,
// `child_process`) that db/autoRefill pull in via `pg`. The ONLY structure
// webpack folds away on the edge build is a dynamic import INSIDE the
// positive `process.env.NEXT_RUNTIME === 'nodejs'` branch (the value is
// inlined at build time). An early-return guard with imports after it does
// NOT fold — the build dies with "Module not found: Can't resolve 'path'".
// Keep every node-only import nested in the branch below.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { db } = await import('@/lib/db');
    const { runAutoRefill } = await import('@/lib/autoRefill');

    process.on('unhandledRejection', (reason) => {
      console.error('[unhandledRejection]', reason);
    });

    process.on('uncaughtException', (err) => {
      console.error('[uncaughtException]', err);
    });

    // Guard against double-scheduling (hot reload / dev).
    const g = globalThis as unknown as { __autoRefillScheduler?: boolean };
    if (g.__autoRefillScheduler) return;
    g.__autoRefillScheduler = true;

    const log = (...a: unknown[]) => console.log('[auto-refill]', ...a);

    const tick = async () => {
      try {
        const cfg = await db.getAppConfig();
        if (!cfg || !cfg.auto_refill_enabled) return;

        const now = new Date();
        const [h, m] = (cfg.auto_refill_time || '09:00').split(':').map(Number);
        const target = new Date(now);
        target.setHours(h, m, 0, 0);

        // Fire when we reach/pass the target time today but haven't run today.
        const alreadyRanToday =
          cfg.auto_refill_last_run &&
          new Date(cfg.auto_refill_last_run).toDateString() === now.toDateString();
        const due =
          cfg.auto_refill_last_run
            ? now.getTime() >= target.getTime() && !alreadyRanToday
            : now.getTime() >= target.getTime();

        // Enforce a sane window (fire any time at/after target, but this is only
        // a ~minute check so it won't run repeatedly; last_run dedupes a restart).
        if (!due) return;

        log('daily trigger reached — starting auto-refill');
        // Mark it split-second BEFORE running so a concurrent tick/restart can't
        // double-fire the same day.
        try {
          await db.touchAutoRefillRun();
        } catch (e) {
          log('mark run failed', e);
        }
        const res = await runAutoRefill({ trigger: 'cron' });
        log(res.message, res.error || '');
      } catch (e) {
        log('tick error', e);
      }
    }

    // Wait for DB availability before the first tick, then poll every 60s.
    setTimeout(async function first() {
      await tick();
      setInterval(tick, 60_000);
    }, 10_000);
  }
}
