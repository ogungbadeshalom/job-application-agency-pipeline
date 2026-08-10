import { readFileSync } from 'fs';
const env = readFileSync('/root/job-agency/.env.local','utf8').split('\n');
for (const line of env) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !m[1].startsWith('#')) process.env[m[1]]=m[2].replace(/^["']|["']$/g,''); }
const { decryptSecret } = await import('./lib/crypto.ts');
import pg from 'pg';
const c = new pg.Client({host:'localhost',user:'jobbids',password:'jobbids',database:'job_bidder'});
await c.connect();
const r = await c.query('SELECT ai_api_key_encrypted e, ai_api_key_nonce n, ai_model, ai_base_url FROM app_config WHERE id=1');
const key = decryptSecret({ciphertext:r.rows[0].e, nonce:r.rows[0].n});
console.log(key);
