import { renderResumePdf } from  '../lib/resume-pdf';
import type { StructuredResume } from  '../lib/resume-presets';
import { writeFileSync } from 'fs';

const s: StructuredResume = {
  contact: { name: 'Kevin Thai', title: '', email: 'thai.kevin528@gmail.com', phone: '1 (909) 619-3523', location: 'San Francisco, CA', linkedin: '', github: '', website: '' },
  summary: 'Data and software engineer with 12+ years building and shipping reliable data pipelines, warehouses, and reporting features that power product and business decisions. Skilled in Python and Go, strong SQL, and production ETL/ELT with Apache Spark, Airflow, Kafka, and Snowflake.',
  experience: [
    { role: 'Lead Data Engineer', company: 'Salesforce', dates: 'Mar 2022 - Oct 2026', location: 'San Francisco, CA', bullets: [
      'Built and maintained REST APIs and data models backed by PostgreSQL and Snowflake, tuning queries to cut p95 latency.',
      'Led the design and delivery of Python and Go services powering CRM workflow automation.',
      'Introduced CI/CD automation and observability dashboards in Splunk, reducing incidents.',
      'Mentored a team of seven engineers through code review and design sessions.'] },
    { role: 'Senior Data Engineer', company: 'Salesforce', dates: 'Jun 2019 - Feb 2022', location: 'San Francisco, CA', bullets: [
      'Engineered scalable ETL pipelines with Apache Spark and Airflow, processing terabytes of customer data daily.',
      'Developed Python services and SQL data models that streamlined reporting workflows.',
      'Implemented monitoring and alerting with observability tooling, reducing mean time to detection.',
      'Collaborated with product and design partners to ship data-driven features through CI/CD.'] },
    { role: 'Data Engineer', company: 'Personagraph', dates: 'Mar 2016 - Mar 2017', location: 'Sunnyvale, CA', bullets: [
      'Developed Python data pipelines and SQL transformations for a consumer insights platform.',
      'Implemented ETL workflows with Apache Spark and scheduled jobs.',
      'Built REST APIs and backend services that exposed audience data to client tools.'] },
    { role: 'Software Engineer', company: 'Samsung', dates: 'Sep 2014 - Feb 2016', location: 'Mountain View, CA', bullets: [
      'Developed embedded software features in Python and C for consumer electronics products.',
      'Built automated test harnesses and CI scripts that improved defect detection.'] },
    { role: 'Software Engineer', company: 'UC Davis Technology Center', dates: 'Jun 2013 - Aug 2014', location: 'Davis, CA', bullets: [
      'Developed internal web applications with Python, JavaScript, and SQL.',
      'Built and maintained database-backed features and REST endpoints.'] },
  ],
  education: [{ school: 'University of California, Davis', degree: 'Bachelor of Science in Computer Science', dates: 'Aug 2010 - Sep 2014', detail: '' }],
  certifications: [],
  skills: [],
  technicalSkills: [
    { category: 'Data Engineering', items: 'Apache Spark, Apache Airflow, ETL/ELT Pipelines, Kafka, Snowflake, Data Modeling' },
    { category: 'Databases & SQL', items: 'SQL, PostgreSQL, MySQL, Query Optimization' },
    { category: 'Backend', items: 'Python, Go, TypeScript, Node.js, REST APIs, Microservices' },
    { category: 'Cloud & Infrastructure', items: 'AWS, GCP, Docker, Kubernetes, CI/CD' },
  ],
};

async function main() {
  const { structuredToResumeData } = await import( '../lib/resume-pdf');
  const data = structuredToResumeData(s);
  const buf = await renderResumePdf(data, 'kevin');
  writeFileSync('/tmp/kevin_rl_engraved.pdf', Buffer.from(buf));
  console.log('bytes', buf.length);
}
main().catch((e) => { console.error('ERR', e); process.exit(1); });