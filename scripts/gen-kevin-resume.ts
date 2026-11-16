import { renderResumePdf } from '../lib/resume-pdf';
import { writeFileSync } from 'fs';

// Kevin Thai — real content from his Pitchr profile (base_resume_text +
// resume_data), rendered with Pitchr's inbuilt Resume Lab renderer + 'classic'
// design preset (his profile's resume_design).
const data = {
  name: 'Kevin Thai',
  title: 'Senior Data Engineer',
  contact: 'thai.kevin528@gmail.com · (909) 619-3523 · Sacramento, CA · linkedin.com/in/kqthai',
  summary: [
    'Senior Data Engineer with 9+ years building reliable data pipelines that produce trustworthy data and enable strategic business decisions.',
    'Proficient in distributed systems, data warehousing, data architecture, data integration, data migration, and data quality. Experienced leading small teams, mentoring team members, and working in cross-functional environments.',
  ],
  experience: [
    { role: 'Lead Data Engineer', company: 'Salesforce', dates: 'March 2022 - September 2026', bullets: [
      'Developed scalable ETL pipelines with an accompanying Tableau dashboard that garnered the most views by all Salesforce employees',
      'Consolidated pipelines and datasets by 70% to significantly reduce the amount of product maintenance',
      'Enabled self-service capabilities for employees to query data through a scalable big data ecosystem hosted on AWS, orchestrated through Airflow, and managed with Terraform',
    ]},
    { role: 'Senior Data Engineer', company: 'Salesforce', dates: 'June 2019 - February 2022', bullets: [
      'Created high-performing ETL pipelines to process terabytes of Salesforce log data and maintain GDPR compliance',
      'Optimized the efficiency of Spark jobs by 60% through metadata-driven preprocessing and fine-tuning',
    ]},
    { role: 'Data Engineer', company: 'Salesforce', dates: 'June 2017 - May 2019', bullets: [
      'Developed Spark/Scala applications scheduled with Azkaban to ingest data from multiple AWS data centers',
      'Ensured clean and compliant data by incorporating a PostgreSQL user-token mapping table and data quality checks',
    ]},
  ],
  education: [
    { school: 'University of California, Davis', degree: "Bachelor of Computer Science", dates: '2010 - 2014', detail: "Dean's Honor List" },
  ],
  certifications: [],
  skills: ['Apache Spark', 'Amazon Redshift', 'Apache Kafka', 'AWS', 'Airflow', 'Terraform', 'PostgreSQL', 'Scala', 'Tableau', 'ETL', 'Data Warehousing', 'Data Architecture', 'Data Quality'],
  technicalSkills: [
    { category: 'Data', items: 'Spark · Redshift · Kafka · ETL · Data Warehousing' },
    { category: 'Cloud & Infra', items: 'AWS · Airflow · Terraform' },
    { category: 'Languages', items: 'Scala · PostgreSQL · SQL' },
  ],
};

async function main() {
  const buf = await renderResumePdf(data, 'classic');
  writeFileSync('/root/kevin-thai-resume.pdf', buf);
  console.log('OK: wrote /root/kevin-thai-resume.pdf', buf.length, 'bytes');
}
main().catch((e) => { console.error('ERR', e); process.exit(1); });