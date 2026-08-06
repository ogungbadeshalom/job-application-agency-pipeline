// Unit-test the India filter rules (copied from scrape route).
const INDIA_LOCATION =
  /(india|bengaluru|bangalore|hyderabad|chennai|mumbai|new delhi|delhi|gurgaon|gurugram|noida|pune|kolkata|ahmedabad|indore|jaipur|coimbatore|surat|lucknow|kochi|thiruvananthapuram)/i;
const INDIA_URL =
  /(indeed\.co\.in|\.in\b|naukri\.com|lmnindia|linkedin\.com\/jobs\/view\/(?:<[^>]*>.*)?(?:-india|-in)\b|remote\b[^#?]*india)/i;
function isIndia(loc, url) {
  return INDIA_LOCATION.test(loc || '') || INDIA_URL.test(url || '');
}
const cases = [
  // [location, url, expectedIndia]
  ['Bengaluru, Karnataka, India', 'https://www.naukri.com/job', true],
  ['Hyderabad, Telangana, India', 'https://www.indeed.com/viewjob?jk=x', true],
  ['Pune, Maharashtra', 'https://xyz.com/in/jobs', true],
  ['Remote - India', 'https://x.com/', true],
  ['United States', 'https://www.indeed.com/viewjob?jk=1', false],
  ['Remote', 'https://remoteok.com/remote-jobs', false],
  ['New York, NY', 'https://www.linkedin.com/jobs/view/4449143114', false],
  ['London, UK', 'https://uk.indeed.com/', false],
  ['Remote', 'https://www.indeed.com/viewjob?jk=abc&lng=en', false],
  ['Mumbai, India', 'https://x.com/', true],
];
let fail = 0;
for (const [loc, url, exp] of cases) {
  const got = isIndia(loc, url);
  const ok = got === exp;
  if (!ok) fail++;
  console.log(`${ok ? 'OK ' : 'FAIL'} ${JSON.stringify(loc)} ${JSON.stringify(url)} -> ${got} (exp ${exp})`);
}
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURES`);