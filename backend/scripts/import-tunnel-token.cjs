// Explicit operator action only. Reads a protected local file; no Cloudflare API or publication.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const file = path.join(root, fs.existsSync(path.join(root, 'compose.yml')) ? 'secrets/cloudflare-tunnel-token.txt' : 'demo_production/secrets/cloudflare-tunnel-token.txt');
const selfTest = process.argv.includes('--self-test');
const volume = selfTest ? 'st-robot-phase11-secret-qa-' + randomUUID() : 'st-robot-demo_tunnel-credentials';
try {
  const token = selfTest ? randomBytes(48).toString('base64') : fs.readFileSync(file, 'utf8').trim();
  if (token.length < 64 || token.length > 4096 || /\s/.test(token)) throw new Error('Token file is empty or invalid; no secret volume changed');
  const write = `const fs=require('fs'),p='/credentials/tunnel-token';let s=fs.readFileSync(0);if(fs.existsSync(p)){if(!process.argv.includes('--replace'))throw Error('Token already exists; use --replace only for approved rotation');fs.copyFileSync(p,p+'.bak');fs.chownSync(p+'.bak',0,0);fs.chmodSync(p+'.bak',0o600);}fs.chmodSync('/credentials',0o700);fs.chownSync('/credentials',65532,65532);fs.writeFileSync(p+'.tmp',s,{mode:0o400,flag:'wx'});fs.chownSync(p+'.tmp',65532,65532);fs.renameSync(p+'.tmp',p);s.fill(0);`;
  const args = ['run', '--rm', '-i', '--network', 'none', '--user', '0', '--mount', `type=volume,src=${volume},dst=/credentials`, 'st-robot-phase11-demo:local', 'node', '-e', write, '--', ...(process.argv.includes('--replace') ? ['--replace'] : [])];
  const result = spawnSync('docker', args, { input: Buffer.from(token), encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Token import failed; preserve existing secret volume and review operator procedure');
  if (selfTest) {
    const refusal = spawnSync('docker', args, { input: Buffer.from('different-synthetic-value'), encoding: 'utf8' });
    if (refusal.status === 0) throw new Error('Self-test: existing token overwrite was allowed');
    const read = spawnSync('docker', ['run', '--rm', '--network', 'none', '--user', '65532', '--mount', `type=volume,src=${volume},dst=/credentials,readonly`, 'st-robot-phase11-demo:local', 'node', '-e', `const fs=require('fs'),s=fs.statSync('/credentials/tunnel-token');if(s.uid!==65532||(s.mode&0o777)!==0o400)process.exit(1);console.log(require('crypto').createHash('sha256').update(fs.readFileSync('/credentials/tunnel-token')).digest('hex'));`], { encoding: 'utf8' });
    if (read.status !== 0 || read.stdout.trim() !== createHash('sha256').update(token).digest('hex')) throw new Error('Self-test: token ownership/read/overwrite preservation failed');
    console.log('PASS: isolated synthetic token volume; UID65532/mode400, read-only readability and overwrite refusal. No real token or network used.');
  } else console.log('Tunnel token imported to private Docker volume, UID65532/mode400. Connector remains stopped.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  if (selfTest && volume.startsWith('st-robot-phase11-secret-qa-')) {
    const cleanup = spawnSync('docker', ['volume', 'rm', volume], { encoding: 'utf8' });
    if (cleanup.status !== 0) { console.error('Synthetic QA secret volume cleanup failed'); process.exitCode = 1; }
  }
}
