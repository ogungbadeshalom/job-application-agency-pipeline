import { renderResumePdf } from '../lib/resume-pdf';
import { writeFileSync } from 'fs';

// Kevin Thai — tailored to Piko "Data Engineer". Honest: reframes his real
// Salesforce pipeline/warehouse/quality work, highlights real matches (Redshift,
// Airflow, Kafka streaming, Tableau, data quality). Does NOT fabricate dbt /
// Snowflake / Python experience he doesn't have.
const data = {
  name: 'Kevin Thai',
  title: 'Senior Data Engineer',
  contact: 'thai.kevin528@gmail.com · (909) 619-3523 · Sacramento, CA · linkedin.com/in/kqthai',
  summary: [
    'Data engineer with 9+ years owning production ETL/ELT pipelines, warehouse schema, and the data quality that powers product and business reporting.',
    'Cross-functional and low-ego, ships reliable pipelines people trust, and has deep production experience with Redshift, Airflow, and streaming with Kafka at scale.',
  ],
  experience: [
    { role: 'Lead Data Engineer', company: 'Salesforce', dates: 'March 2022 - September 2026', bullets: [
      'Owned large-scale ETL pipelines and a self-service reporting ecosystem on AWS, orchestrated with Airflow and managed with Terraform — the foundation engineering teams query for product decisions',
      'Built a Tableau reporting layer that reached the widest internal adoption across the company, directly powering product and business decisions',
      'Consolidated pipelines and datasets by 70%, cutting maintenance and improving data reliability and cost-efficiency',
    ]},
    { role: 'Senior Data Engineer', company: 'Salesforce', dates: 'June 2019 - February 2022', bullets: [
      'Built high-performing ETL pipelines processing terabytes of log data, designed with strict data-quality and compliance guarantees (GDPR) so data was never silently lost or corrupted',
      'Improved Spark job efficiency by 60% through metadata-driven preprocessing and tuning as data volume grew',
    ]},
    { role: 'Data Engineer', company: 'Salesforce', dates: 'June 2017 - May 2019', bullets: [
      'Developed Spark/Scala ingestion pipelines scheduled with Azkaban, pulling data from multiple data centers into the warehouse',
      'Guarded data quality end-to-end with reference-mapping tables and automated checks so analysts could trust what they queried',
    ]},
  ],
  education: [
    { school: 'University of California, Davis', degree: "Bachelor of Computer Science", dates: '2010 - 2014', detail: "Dean's Honor List" },
  ],
  certifications: [],
  skills: ['ETL/ELT Pipelines', 'Data Quality', 'Amazon Redshift', 'Apache Spark', 'Apache Kafka', 'Airflow', 'AWS', 'Terraform', 'PostgreSQL', 'Scala', 'Tableau', 'Data Modeling', 'Data Warehousing'],
  technicalSkills: [
    { category: 'Pipelines & Orchestration', items: 'Airflow · Azkaban · ETL/ELT · Spark' },
    { category: 'Warehouse & Data', items: 'Amazon Redshift · PostgreSQL · Data Modeling · Data Quality' },
    { category: 'Streaming', items: 'Apache Kafka' },
    { category: 'Cloud & Infra', items: 'AWS · Terraform' },
    { category: 'BI & Reporting', items: 'Tableau' },
  ],
};

async function main() {
  const buf = await renderResumePdf(data, 'classic');
  writeFileSync('/root/kevin-thai-piko.pdf', buf);
  console.log('OK: wrote /root/kevin-thai-piko.pdf', buf.length, 'bytes');
}
main().catch((e) => { console.error('ERR', e); process.exit(1); });