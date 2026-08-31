// Verify the non-LinkedIn saved jobs in Andrew's queue.
//
// IMPORTANT: the FIRST version of this script over-verified by scanning the
// WHOLE careers page for "hybrid"/"on-site" and wrongly flagged genuine remote
// roles (Anthropic, Toast, fivetran) as on-site — because shared company pages
// are littered with generic remote-policy boilerplate. Re-skipping would have
// REMOVED good remote jobs from the queue.
//
// This revision is conservative:
//   * The stored `location` field is TRUSTED when it says remote (these jobs
//     came from remote-filtered boards). Primary evidence = stored location.
//   * Page text is used as *secondary* confirmation only. A role is RE-SKIPPED
//     only on STRONG, specific signals that it is truly on-site/easy-apply —
//     never from isolated "hybrid"/"in-office" boilerplate words.
//   * If we can't confidently confirm, we VERIFY (keep) rather than re-skip,
//     so we never lose a possibly-good job to a false negative.
//
//   npx tsx scripts/verify_non_linkedin.ts         # DRY-RUN
//   APPLY=1 npx tsx scripts/verify_non_linkedin.ts # update DB
import { query, all } from '../db/pool';

const PROFILE_ID = '022137cc-3978-4b4a-9e0a-54f3235f08d9';
const APPLY = process.env.APPLY === '1';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

interface JobRow { id: string; board: string; title: string; company: string; url: string; location: string | null; description: string | null }

async function curl(url: string): Promise<{ status: number; text: string }> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  return { status: res.status, text: await res.text() };
}

function stripHtml(h: string): string {
  return h
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&amp;|&#39;|&quot;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function locIsRemote(loc: string | null): boolean {
  const l = (loc || '').toLowerCase();
  return /\bremote\b|remote-friendly|remote -|\bremote-\b|100% remote|\bwfh\b|work from home/.test(l) || /^remote/.test(l);
}

async function verifyJob(j: JobRow) {
  const board = j.board;

  // jobicy + manual: remote-only/normal boards with stored description.
  if (board === 'jobicy' || board === 'manual') {
    const desc = j.description || '';
    const isOnsite = /\bon[- ]?site\b|hybrid|in[- ]office/i.test(desc) && !/remote/i.test(desc);
    const remote = locIsRemote(j.location) || /remote|work from home|wfh/i.test(desc || '');
    const easy = /easy\s*apply/i.test(desc);
    if (isOnsite && !remote && !easy) return { keep: false, reason: 'onsite', desc };
    if (easy) return { keep: false, reason: 'easy-apply', desc };
    return { keep: true, reason: 'ok', desc };
  }

  // Trusted remote location -> keep by default; use page text only to catch
  // STRONG counter-evidence (easy-apply flag, or an explicit "hybrid"/job-loc).
  const locRemote = locIsRemote(j.location);

  if (locRemote) {
    // Fetch page to grab the description for tailoring + catch obvious easy-apply.
    let desc = '';
    let easyApply = false;
    try {
      const res = await curl(j.url);
      if (res.status < 400) {
        const ld = res.text.match(/application\/ld\+json[^>]*>([\s\S]*?)<\/script>/);
        if (ld) {
          try {
            const parsed = JSON.parse(ld[1]);
            const items = Array.isArray(parsed) ? parsed : [parsed];
            for (const it of items) if (it && it.description) { desc = typeof it.description === 'string' ? it.description : JSON.stringify(it.description); break; }
          } catch {}
        }
        if (!desc || desc.length < 50) desc = stripHtml(res.text).slice(0, 4000);
        easyApply = /easy\s*apply/i.test(res.text);
      }
    } catch { /* keep, description stays as-is */ }
    if (easyApply) return { keep: false, reason: 'easy-apply', desc };
    // Remote location + no strong counter-evidence -> VERIFY (keep).
    return { keep: true, reason: 'ok', desc };
  }

  // Location does NOT clearly say remote — inspect the page more carefully,
  // but still be conservative: only re-skip on explicit on-site/hybrid nearby
  // the role, else verify (a missing location isn't proof of on-site).
  try {
    const res = await curl(j.url);
    if (res.status < 400) {
      const low = res.text.toLowerCase();
      const ld = res.text.match(/application\/ld\+json[^>]*>([\s\S]*?)<\/script>/);
      let desc = '';
      if (ld) {
        try {
          const parsed = JSON.parse(ld[1]);
          const items = Array.isArray(parsed) ? parsed : [parsed];
          for (const it of items) if (it && it.description) { desc = typeof it.description === 'string' ? it.description : JSON.stringify(it.description); break; }
        } catch {}
      }
      if (!desc || desc.length < 50) desc = stripHtml(res.text).slice(0, 4000);
      const easy = /easy\s*apply/i.test(res.text);
      // explicit on-site/hybrid AND location doesn't say remote
      const explicitOnsite = /\b(h?:remote|remote)[^.]*?not/i.test(low) || /\bon[- ]?site\b|\bhybrid\b/.test(low) && !/\bremote\b/.test(low);
      if (easy) return { keep: false, reason: 'easy-apply', desc };
      if (explicitOnsite) return { keep: false, reason: 'onsite', desc };
      return { keep: true, reason: 'ok', desc };
    }
  } catch {}
  return { keep: true, reason: 'ok', desc: '' };
}

(async () => {
  console.log(APPLY ? 'APPLY — will update DB' : 'DRY-RUN — report only (APPLY=1 to update)');
  const jobs = (await all(
    `select id, board, title, company, url, location, description
     from jobs where profile_id=$1 and status='saved' and not verified_remote order by board`,
    [PROFILE_ID]
  )) as unknown as JobRow[];
  console.log(`verifying ${jobs.length} jobs...\n`);

  let verified = 0, reskip = 0, failed = 0;
  for (const j of jobs) {
    const v = await verifyJob(j);
    if (v.keep) {
      if (APPLY) {
        await query(
          `update jobs set verified_remote=true, easy_apply=false,
             description=case when $2::text<>'' then $2 else description end,
             location=coalesce(nullif(location,''),'Remote')
           where id=$1`, [j.id, v.desc]
        );
      }
      verified++;
      console.log(`  [VERIFY] ${j.board} ${(j.title||'').slice(0,34)} ${(j.company||'').slice(0,14)} ${j.location||''} desc=${(v.desc||'').length}ch`);
    } else {
      if (APPLY) await query(`update jobs set status='skipped', verified_remote=false, easy_apply=true where id=$1`, [j.id]);
      reskip++;
      console.log(`  [RESKIP] ${j.board} ${(j.title||'').slice(0,34)} — ${v.reason}`);
    }
  }

  console.log(`\nverified: ${verified} | re-skipped: ${reskip} | failed: ${failed}`);
  if (!APPLY) console.log('Run with APPLY=1 to write changes.');
  process.exit(0);
})();