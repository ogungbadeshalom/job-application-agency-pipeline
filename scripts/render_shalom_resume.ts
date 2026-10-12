// Render Shalom's main resume through the app's OWN resume-builder pipeline
// (structuredToResumeData -> renderResumePdf) so the output matches exactly
// what the Resume Lab produces.
import { writeFileSync } from 'node:fs';
import {
  renderResumePdf,
  structuredToResumeData,
  type ResumePreset,
} from '../lib/resume-pdf';
import type { StructuredResume } from '../lib/resume-presets';

const resume: StructuredResume = {
  contact: {
    name: 'OGUNGBADE SHALOM',
    title: 'Software Engineer · Full-Stack Developer',
    email: 'badeshalom@gmail.com',
    phone: '08145092705',
    location: 'Lagos, Nigeria',
    linkedin: 'linkedin.com/in/ogungbade-shalom',
    github: 'github.com/OgungbadeShalom',
    website: '',
  },
  summary:
    "Full-stack software engineer and solo founder who designs, builds, and ships production systems end-to-end — from database schema to deployment. Core stack is Next.js, TypeScript, PostgreSQL, and Drizzle ORM, deployed on Hetzner via Coolify. Currently building multi-tenant SaaS platforms and autonomous AI agent pipelines (BullMQ/Redis job orchestration, LLM-driven agentic workflows) that automate real business operations. Comfortable owning a product from architecture and security through to go-to-market.",
  experience: [
    {
      role: 'Founder — Reverse Recruiting & VA Agency (Self-Employed)',
      company: '',
      dates: 'Jul 2024 – Present',
      location: '',
      bullets: [
        'Built and operate Hermes, an autonomous agentic system (Scout, Matcher, Writer, Submitter pipeline) that discovers job opportunities and generates tailored applications at scale.',
        'Submitted 15,000+ job applications on behalf of clients, combining automation with manual quality review.',
        'Delivered freelance reverse recruiting, ATS resume optimization, and virtual assistant services on Upwork, including onboarding new freelancers to the platform.',
      ],
    },
    {
      role: 'Software Engineer Intern',
      company: 'IHS Towers',
      dates: 'Feb 2025 – Jun 2025',
      location: 'Lagos, Nigeria',
      bullets: [
        'Designed and built an internal travel-request application covering submission, multi-stage manager approval, and status tracking across employee, manager, and admin roles.',
        'Engineered the PostgreSQL/Drizzle ORM backend — normalized schema, migrations, and transactional handling that kept request state consistent under concurrent approvals.',
        'Built a responsive React/Next.js frontend with role-based access control, REST API integration, and form validation.',
        'Integrated automated email notifications so approvers are alerted instantly, cutting manual follow-up during the approval cycle.',
        'Wrote and maintained clean, typed TypeScript across the stack, following Git-based code review and branching workflows with the engineering team.',
        'Participated in sprint planning, standups, and code reviews, gathering requirements from staff users and translating them into shipped features.',
      ],
    },
    {
      role: 'Frontend Engineer Intern',
      company: '390',
      dates: 'Jan 2025',
      location: 'Lagos, Nigeria',
      bullets: [
        'Studied the company codebase and internal documentation to understand existing architecture, conventions, and component patterns before shipping changes.',
        'Worked directly on the company website UI, implementing responsive, pixel-accurate React components from designs.',
        'Styled interfaces with Tailwind CSS, shipping mobile-first layouts that held up across breakpoints and devices.',
        'Consumed REST APIs and wired client-side state management to power data-driven views and dynamic user flows.',
        'Improved frontend accessibility and performance — semantic HTML, keyboard-friendly interactions, and leaner component rendering.',
        'Collaborated with senior engineers via Git/GitHub — feature branches, pull requests, and iterative feedback on UI changes.',
      ],
    },
  ],
  education: [
    {
      school: 'Babcock University',
      degree: 'B.Sc. Software Engineering',
      dates: '2022 – 2026',
      detail: 'Relevant coursework: Cloud Computing, Formal Methods, Human-Computer Interaction',
    },
  ],
  certifications: [],
  skills: [],
  technicalSkills: [
    {
      category: 'Languages & Frameworks',
      items: 'TypeScript, JavaScript, Next.js, React, Node.js, Express',
    },
    {
      category: 'Data & Infrastructure',
      items: 'PostgreSQL, Drizzle ORM, Redis/BullMQ, Docker, Coolify, Hetzner, Git/GitHub',
    },
    {
      category: 'AI & Automation',
      items: 'Agentic workflow design, LLM prompt engineering & cost optimization, OpenCode, DeepSeek/Claude API integration',
    },
    {
      category: 'Other',
      items: 'Godot 4 game development, C#/Lua/GDScript, Spring Boot (Java), Google Cloud Platform',
    },
  ],
};

async function main() {
  const preset = (process.argv[2] as ResumePreset) || 'classic';
  const data = structuredToResumeData(resume);
  // Full contact line incl. GitHub/LinkedIn — the app's converter only joins email/phone/location.
  data.contact = [
    resume.contact.email,
    resume.contact.phone,
    resume.contact.location,
    resume.contact.github,
    resume.contact.linkedin,
  ].filter(Boolean).join(' | ');
  const buf = await renderResumePdf(data, preset);
  const out = `/root/Shalom_Main_Resume_${preset}.pdf`;
  writeFileSync(out, buf);
  console.log('wrote', out, buf.length, 'bytes');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});