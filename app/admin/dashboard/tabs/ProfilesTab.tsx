'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/Modal';
import { Plus, Spinner } from '@/components/Icon';
import type { Job, Profile, User } from '@/lib/types';
import { LabeledInput } from './shared';

export default function ProfilesTab({
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