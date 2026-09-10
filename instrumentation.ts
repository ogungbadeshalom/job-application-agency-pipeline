// Next.js 14 instrumentation hook. Runs once at server boot (in Node runtime).
// We use it to install process-level safety nets and the admin-toggled daily
// AUTO-REFILL scheduler. The scheduler checks app_config every 60s; when
// auto_refill_enabled is on AND the wall clock crosses auto_refill_time, it
// fires runAutoRefill once (deduped by auto_refill_last_run) and updates state
// live so workers see "auto-refill in progress" and can't stack a manual refill.

import { db } from '@/lib/db';
import { runAutoRefill } from '@/lib/autoRefill';

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

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

  async function tick() {
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