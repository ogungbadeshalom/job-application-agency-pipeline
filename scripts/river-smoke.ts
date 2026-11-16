import { riverJobs } from '../lib/jobRiver';
(async () => {
  const jobs = await riverJobs(['data engineer'], { perTermLimit: 10, maxTotal: 20 });
  console.log('riverJobs returned:', jobs.length);
  for (const j of jobs.slice(0,5)) console.log('-', j.title, '|', j.company, '| board=', j.site);
})();
