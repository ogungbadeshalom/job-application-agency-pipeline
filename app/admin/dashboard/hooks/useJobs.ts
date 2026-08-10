'use client';
import { useState, useCallback, useEffect, useRef } from 'react';
import type { Job } from '@/lib/types';

// Controlled jobs list state. `refresh()` re-fetches from the API so the table
// updates in place (no hard page reload) after mutations like Refill Jobs.
export function useJobs(initial: Job[]) {
  const [jobs, setJobs] = useState<Job[]>(initial);
  const initialRef = useRef(initial);

  // Keep local state in sync when the server passes NEW initial data (e.g. after
  // a router.refresh() triggered by Add/Edit/delete), instead of staying stale
  // forever on the first render's copy. Compare by value so re-renders with the
  // same data (RSC passes stable references) don't clobber a pending refresh.
  useEffect(() => {
    const before = initialRef.current;
    initialRef.current = initial;
    if (JSON.stringify(before) !== JSON.stringify(initial)) setJobs(initial);
  }, [initial]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs');
      if (!res.ok) return;
      // Parse defensively so an HTML/oddly-empty body can't throw
      // "Unexpected token '<'".
      const data = (await res.json().catch(() => null)) ?? {};
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch {
      // ignore transient fetch errors; keep current list
    }
  }, []);
  return { jobs, setJobs, refresh };
}