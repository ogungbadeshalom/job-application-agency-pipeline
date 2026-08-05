'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/Modal';
import { Doc, Spinner } from '@/components/Icon';
import type { Job, Profile } from '@/lib/types';

export default function ResumesTab({ profiles, jobs }: { profiles: Profile[]; jobs: Job[] }) {
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