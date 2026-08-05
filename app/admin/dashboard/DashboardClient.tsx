'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import JobTable from '@/components/JobTable';
import RefillJobsModal from '@/components/RefillJobsModal';
import Modal from '@/components/Modal';
import { Plus, Refresh, Doc, Spinner } from '@/components/Icon';
import type { Job, Profile, ScrapeRun, User } from '@/lib/types';

type Tab = 'applications' | 'profiles' | 'resumes' | 'settings';

export default function DashboardClient({
  user,
  nav,
  initialJobs,
  profiles,
  users,
  scrapeRuns,
}: {
  user: User;
  nav: { href: string; label: string; badge?: number }[];
  initialJobs: Job[];
  profiles: Profile[];
  users: User[];
  scrapeRuns: ScrapeRun[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('applications');
  const [jobs] = useState(initialJobs);
  const [refillOpen, setRefillOpen] = useState(false);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'applications', label: 'Applications', count: jobs.length },
    { key: 'profiles', label: 'Profiles', count: profiles.length },
    { key: 'resumes', label: 'Resumes' },
    { key: 'settings', label: 'Settings' },
  ];

  return (
    <DashboardLayout
      user={user}
      nav={nav}
      active="/admin/dashboard"
      actions={
        <button
          onClick={() => setRefillOpen(true)}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-brand-greenDark text-white hover:bg-emerald-700"
        >
          <Refresh size={15} /> Refill Jobs
        </button>
      }
    >
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-navy-700 mb-5">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-brand-green text-navy-100'
                : 'border-transparent text-navy-400 hover:text-navy-200'
            }`}
          >
            {t.label}
            {typeof t.count === 'number' && (
              <span className="ml-2 text-xs text-navy-500">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'applications' && (
        <JobTable jobs={jobs} profiles={profiles} mode="admin" />
      )}
      {tab === 'profiles' && <ProfilesTab profiles={profiles} users={users} jobs={jobs} />}
      {tab === 'resumes' && <ResumesTab profiles={profiles} jobs={jobs} />}
      {tab === 'settings' && <SettingsTab users={users} scrapeRuns={scrapeRuns} />}

      <RefillJobsModal
        open={refillOpen}
        onClose={() => setRefillOpen(false)}
        profiles={profiles}
        onDone={() => router.refresh()}
      />
    </DashboardLayout>
  );
}

// ---------------------------------------------------------------------------
// Profiles tab
// ---------------------------------------------------------------------------
function ProfilesTab({
  profiles,
  users,
  jobs,
}: {
  profiles: Profile[];
  users: User[];
  jobs: Job[];
}) {
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [addWorkerOpen, setAddWorkerOpen] = useState(false);

  const workerName = (id: string | null) =>
    id ? users.find((u) => u.id === id)?.full_name ?? '—' : '—';
  const appliedCount = (pid: string) =>
    jobs.filter((j) => j.profile_id === pid && ['applied','interview','offer'].includes(j.status)).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-navy-100">Clients &amp; Workers</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setAddWorkerOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-navy-800 text-navy-200 hover:bg-navy-750"
          >
            <Plus size={15} /> Add Worker
          </button>
          <button
            onClick={() => setAddClientOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-navy-800 text-navy-200 hover:bg-navy-750"
          >
            <Plus size={15} /> Add Client
          </button>
        </div>
      </div>
      <div className="panel overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-navy-700">
              <th className="th-uppercase text-left px-3 py-2">Client</th>
              <th className="th-uppercase text-left px-3 py-2">Email</th>
              <th className="th-uppercase text-left px-3 py-2">Assigned Worker</th>
              <th className="th-uppercase text-left px-3 py-2">Jobs Applied</th>
              <th className="th-uppercase text-left px-3 py-2">Search Terms</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id} className="border-b border-navy-800 row-hover">
                <td className="px-3 py-2.5 text-navy-100">{p.name}</td>
                <td className="px-3 py-2.5 text-navy-400">{p.email}</td>
                <td className="px-3 py-2.5 text-navy-300">{workerName(p.assigned_worker_id)}</td>
                <td className="px-3 py-2.5 text-navy-300">{appliedCount(p.id)}</td>
                <td className="px-3 py-2.5 text-navy-500 text-xs">
                  {(p.scrape_search_terms || []).join(', ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AddWorkerModal
        open={addWorkerOpen}
        onClose={() => setAddWorkerOpen(false)}
        profiles={profiles}
      />
      <AddClientModal
        open={addClientOpen}
        onClose={() => setAddClientOpen(false)}
        workers={users.filter((u) => u.role === 'worker')}
      />
    </div>
  );
}

function AddWorkerModal({
  open,
  onClose,
  profiles,
}: {
  open: boolean;
  onClose: () => void;
  profiles: Profile[];
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [profileId, setProfileId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          role: 'worker',
          full_name: fullName,
          profileId: profileId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Worker"
      subtitle="Create a worker account and assign a client."
      footer={
        <>
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md text-navy-300 hover:bg-navy-800">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={loading || !fullName || !email || !password}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-brand-greenDark text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? <Spinner /> : null}
            Create
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <LabeledInput label="Full name" value={fullName} onChange={setFullName} placeholder="Worker Name" />
        <LabeledInput label="Email" value={email} onChange={setEmail} placeholder="worker@jobbidder.com" />
        <LabeledInput label="Temporary password" value={password} onChange={setPassword} placeholder="login password" />
        <div>
          <label className="block th-uppercase mb-1">Assigned client</label>
          <select
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            className="w-full bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100"
          >
            <option value="">— none —</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-navy-500 mt-1">
            When a worker is assigned to a client&apos;s profile, they can also be attached by editing the profile.
          </p>
        </div>
        {error && (
          <div className="text-sm text-brand-red bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

function AddClientModal({
  open,
  onClose,
  workers,
}: {
  open: boolean;
  onClose: () => void;
  workers: User[];
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [workerId, setWorkerId] = useState(workers[0]?.id ?? '');
  const [terms, setTerms] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      // Create a client user (with password) + a profile.
      const userRes = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          role: 'client',
          full_name: fullName || name,
          profileName: name,
          assigned_worker_id: workerId || null,
        }),
      });
      const userData = await userRes.json();
      if (!userRes.ok) throw new Error(userData.error || 'Failed to create account');

      // Find the new profile and update its search terms.
      const profilesRes = await fetch('/api/profiles');
      const profilesData = await profilesRes.json();
      const newProfile = (profilesData.profiles ?? []).find(
        (p: Profile) => p.email === email.toLowerCase()
      );
      if (newProfile && terms.trim()) {
        await fetch(`/api/profiles`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: newProfile.id,
            scrape_search_terms: terms.split(',').map((t) => t.trim()).filter(Boolean),
          }),
        });
      }
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Client"
      subtitle="Create a client account + profile and assign a worker."
      footer={
        <>
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md text-navy-300 hover:bg-navy-800">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={loading || !name || !email || !password}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-brand-greenDark text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? <Spinner /> : null}
            Create
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <LabeledInput label="Client name" value={name} onChange={setName} placeholder="Acme Corp" />
        <LabeledInput label="Contact / display name" value={fullName} onChange={setFullName} placeholder="Acme Contact" />
        <LabeledInput label="Email" value={email} onChange={setEmail} placeholder="ops@acme.com" />
        <LabeledInput label="Temporary password" value={password} onChange={setPassword} placeholder="login password" />
        <div>
          <label className="block th-uppercase mb-1">Assigned worker</label>
          <select
            value={workerId}
            onChange={(e) => setWorkerId(e.target.value)}
            className="w-full bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100"
          >
            <option value="">— none —</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.full_name} ({w.email})
              </option>
            ))}
          </select>
        </div>
        <LabeledInput
          label="Search terms (comma-separated)"
          value={terms}
          onChange={setTerms}
          placeholder="backend engineer, platform engineer"
        />
        {error && (
          <div className="text-sm text-brand-red bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Resumes tab
// ---------------------------------------------------------------------------
function ResumesTab({ profiles, jobs }: { profiles: Profile[]; jobs: Job[] }) {
  const [uploadFor, setUploadFor] = useState<Profile | null>(null);

  const lastTailored = (pid: string) => {
    const ts = jobs
      .filter((j) => j.profile_id === pid && j.tailored_resume)
      .map((j) => Date.parse(j.updated_at))
      .sort((a, b) => b - a)[0];
    return ts ? new Date(ts).toLocaleDateString() : '—';
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-navy-100">Resumes</h2>
      </div>
      <div className="panel overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-navy-700">
              <th className="th-uppercase text-left px-3 py-2">Client</th>
              <th className="th-uppercase text-left px-3 py-2">Resume File</th>
              <th className="th-uppercase text-left px-3 py-2">Chars</th>
              <th className="th-uppercase text-left px-3 py-2">Last Tailored</th>
              <th className="th-uppercase text-left px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id} className="border-b border-navy-800">
                <td className="px-3 py-2.5 text-navy-100">{p.name}</td>
                <td className="px-3 py-2.5">
                  {p.base_resume_url ? (
                    <a
                      href={`/api/files/${p.base_resume_url.split('/').filter(Boolean).join('/')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-brand-blue hover:underline"
                    >
                      <Doc size={14} /> {p.base_resume_url.split('/').pop()}
                    </a>
                  ) : (
                    <span className="text-navy-500">No resume</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-navy-400">
                  {p.base_resume_text ? p.base_resume_text.length.toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2.5 text-navy-400">{lastTailored(p.id)}</td>
                <td className="px-3 py-2.5 text-right">
                  <button
                    onClick={() => setUploadFor(p)}
                    className="px-2.5 py-1 text-xs rounded-md bg-navy-800 text-navy-200 hover:bg-navy-750"
                  >
                    {p.base_resume_url ? 'Replace' : 'Upload'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {uploadFor && (
        <UploadModal profile={uploadFor} onClose={() => setUploadFor(null)} />
      )}
    </div>
  );
}

function UploadModal({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('profile_id', profile.id);
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Upload resume — ${profile.name}`}
      subtitle="PDF or DOCX. Text is extracted for AI tailoring."
      footer={
        <>
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md text-navy-300 hover:bg-navy-800">
            Cancel
          </button>
          <button
            onClick={upload}
            disabled={loading || !file}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-brand-greenDark text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? <Spinner /> : null}
            Upload
          </button>
        </>
      }
    >
      <input
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-navy-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-navy-800 file:text-navy-100 hover:file:bg-navy-750"
      />
      {error && (
        <div className="mt-3 text-sm text-brand-red bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
          {error}
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------
function SettingsTab({ users, scrapeRuns }: { users: User[]; scrapeRuns: ScrapeRun[] }) {
  const [resetTarget, setResetTarget] = useState<User | null>(null);

  return (
    <div className="space-y-6">
      <section className="panel overflow-hidden">
        <div className="p-3 border-b border-navy-700">
          <h3 className="text-sm font-semibold text-navy-200">Team</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-navy-700">
              <th className="th-uppercase text-left px-3 py-2">Name</th>
              <th className="th-uppercase text-left px-3 py-2">Email</th>
              <th className="th-uppercase text-left px-3 py-2">Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-navy-800">
                <td className="px-3 py-2.5 text-navy-100">{u.full_name}</td>
                <td className="px-3 py-2.5 text-navy-400">{u.email}</td>
                <td className="px-3 py-2.5 capitalize text-navy-300">{u.role}</td>
                <td className="px-3 py-2.5 text-right">
                  <button
                    onClick={() => setResetTarget(u)}
                    className="px-2.5 py-1 text-xs rounded-md bg-navy-800 text-navy-200 hover:bg-navy-750"
                  >
                    Reset password
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel overflow-hidden">
        <div className="p-3 border-b border-navy-700">
          <h3 className="text-sm font-semibold text-navy-200">API Key Configuration</h3>
        </div>
        <div className="p-4 text-sm text-navy-400 space-y-2">
          <p>
            Set one of the following in <code className="text-navy-200">.env.local</code>:
          </p>
          <ul className="list-disc list-inside text-navy-500 space-y-1 ml-2">
            <li><code className="text-navy-300">ANTHROPIC_API_KEY</code> (AI_PROVIDER=anthropic)</li>
            <li><code className="text-navy-300">OPENROUTER_API_KEY</code> (AI_PROVIDER=openrouter)</li>
            <li><code className="text-navy-300">AI_BASE_URL</code> + <code className="text-navy-300">AI_API_KEY</code> (AI_PROVIDER=custom)</li>
          </ul>
          <p className="text-xs text-navy-500 pt-1">
            Provider: <span className="text-navy-300">{process.env.NEXT_PUBLIC_AI_PROVIDER || 'anthropic'}</span>
          </p>
        </div>
      </section>

      <section className="panel overflow-hidden">
        <div className="p-3 border-b border-navy-700">
          <h3 className="text-sm font-semibold text-navy-200">Scrape Run History</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-navy-700">
              <th className="th-uppercase text-left px-3 py-2">Status</th>
              <th className="th-uppercase text-left px-3 py-2">Sites</th>
              <th className="th-uppercase text-left px-3 py-2">Terms</th>
              <th className="th-uppercase text-left px-3 py-2">Found</th>
              <th className="th-uppercase text-left px-3 py-2">Added</th>
              <th className="th-uppercase text-left px-3 py-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {scrapeRuns.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-navy-500">No scrape runs yet.</td>
              </tr>
            )}
            {scrapeRuns.map((r) => (
              <tr key={r.id} className="border-b border-navy-800">
                <td className="px-3 py-2.5">
                  <ScrapeStatus status={r.status} />
                </td>
                <td className="px-3 py-2.5 text-navy-400">{(r.sites || []).join(', ')}</td>
                <td className="px-3 py-2.5 text-navy-500 text-xs">{(r.search_terms || []).join(', ')}</td>
                <td className="px-3 py-2.5 text-navy-300">{r.jobs_found}</td>
                <td className="px-3 py-2.5 text-brand-green">{r.jobs_added}</td>
                <td className="px-3 py-2.5 text-navy-500 text-xs">
                  {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {resetTarget && (
        <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />
      )}
    </div>
  );
}

function ResetPasswordModal({ user, onClose }: { user: User; onClose: () => void }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Reset password — ${user.email}`}
      footer={
        <>
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md text-navy-300 hover:bg-navy-800">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={loading || !password}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-brand-greenDark text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? <Spinner /> : null}
            Set password
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <LabeledInput
          label="New password"
          value={password}
          onChange={setPassword}
          placeholder="temporary password"
        />
        {error && (
          <div className="text-sm text-brand-red bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ScrapeStatus({ status }: { status: ScrapeRun['status'] }) {
  const map: Record<ScrapeRun['status'], { c: string; t: string }> = {
    pending: { c: 'bg-navy-700 text-navy-300', t: 'Pending' },
    running: { c: 'bg-blue-500/15 text-brand-blue', t: 'Running' },
    completed: { c: 'bg-emerald-500/15 text-brand-green', t: 'Completed' },
    failed: { c: 'bg-red-500/15 text-brand-red', t: 'Failed' },
  };
  const s = map[status];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${s.c}`}>{s.t}</span>;
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block th-uppercase mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-blue"
      />
    </div>
  );
}
