'use client';
import { useState, useCallback } from 'react';
import type { Job } from '@/lib/types';

// Controlled jobs list state. `refresh()` re-fetches from the API so the table
// updates in place (no hard page reload) after mutations like Refill Jobs.
export function useJobs(initial: Job[]) {
  const [jobs, setJobs] = useState<Job[]>(initial);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs');
      if (!res.ok) return;
      const data = await res.json();
      setJobs(data.jobs ?? []);
    } catch {
      // ignore transient fetch errors; keep current list
    }
  }, []);
  return { jobs, setJobs, refresh };
}