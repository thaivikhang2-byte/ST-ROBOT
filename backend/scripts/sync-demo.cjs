// Copy the reviewed release only. Runtime secrets/data are never part of this manifest.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const demo = path.join(root, 'demo_production');
const entries = [
  ['frontend/public', 'frontend/public'], ['frontend/src', 'frontend/src'],
  ['backend/src', 'backend/src'], ['backend/prisma', 'backend/prisma'],
  ...['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'nest-cli.json', 'Dockerfile', '.dockerignore'].map(n => ['backend/' + n, 'backend/' + n]),
  ...['bootstrap-admin.ts', 'export-openapi.ts', 'configure-gemini-demo.cjs', 'import-tunnel-token.cjs', 'prepare-operations.cjs'].map(n => ['backend/scripts/' + n, 'backend/scripts/' + n]),
  ['docs/phase11-evidence', 'docs/phase11-evidence'],
  ['docs/phase12-evidence', 'docs/phase12-evidence'],
  ...['ai-agent-architecture.md', 'ai-tool-registry.md', 'ai-authorization.md', 'ai-action-confirmation.md', 'ai-memory-design.md', 'ai-memory-retention.md', 'ai-frontend-integration.md', 'ai-security-review.md', 'phase13-test-report.md', 'phase13-report.vi.md', 'phase13-acceptance.md', 'phase13-openapi.json'].map(n => ['docs/' + n, 'docs/' + n]),
  ['docs/phase12-files.json', 'docs/phase12-files.json'],
  ['docs/phase12-openapi.json', 'docs/phase12-openapi.json'],
  ['docs/phase11-files.json', 'docs/phase11-files.json'],
  ['docker', 'docker'], ['config/gemini-demo.json', 'config/gemini-demo.json'],
  ['docker-compose.demo.yml', 'compose.yml'], ['docker-compose.monitoring.yml', 'compose.monitoring.yml'], ['.env.example', '.env.example'],
  ['docs/demo-production.md', 'README.md'],
  ...['phase11-implementation.md', 'legacy-ui-restoration.md', 'ui-visual-comparison.md', 'cloudflare-tunnel-setup.md', 'reverse-proxy-architecture.md', 'cloudflare-security.md', 'phase11-test-report.md', 'phase12-implementation.md', 'selfstudy-ui-rollback.md', 'selfstudy-backend-compatibility.md', 'observability-architecture.md', 'monitoring-runbook.md', 'ai-usage-monitoring.md', 'backup-recovery.md', 'phase12-security-review.md', 'phase12-test-report.md', 'phase13-baseline-audit.md', 'phase13-management-ai.md', 'ai-system-prompts.md', 'ai-rag-architecture.md', 'ai-cache-policy.md', 'ai-intelligent-routing.md', 'ai-openrouter-integration.md', 'ai-cloudflare-workers-ai.md', 'ai-retry-failover.md', 'ai-tool-security.md', 'phase13-management-ai-tests.md'].map(n => ['docs/' + n, 'docs/' + n]),
];
const files = [];
function collect(source, dest) {
  const p = path.join(root, source), stat = fs.lstatSync(p);
  if (stat.isSymbolicLink()) throw new Error('Symlink is not allowed in the demo release');
  if (stat.isDirectory()) for (const n of fs.readdirSync(p)) collect(source + '/' + n, dest + '/' + n);
  else files.push({ source, dest });
}
for (const [s, d] of entries) collect(s, d);
const digest = data => createHash('sha256').update(data).digest('hex');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
let changed = 0;
for (const file of files) {
  const bytes = fs.readFileSync(path.join(root, file.source));
  const target = path.join(demo, file.dest);
  if (!target.startsWith(demo + path.sep)) throw new Error('Path escaped demo directory');
  file.sha256 = digest(bytes); file.bytes = bytes.length;
  if (fs.existsSync(target)) {
    const old = fs.readFileSync(target);
    if (digest(old) === file.sha256) continue;
    const backup = path.join(demo, '.backups', stamp, file.dest);
    fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.writeFileSync(backup, old, { flag: 'wx' });
  }
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes); changed++;
}
fs.writeFileSync(path.join(demo, 'release-manifest.json'), JSON.stringify({ phase: 13, verificationScope: 'local-supported-features', productionReady: false, generatedAt: stamp, upstream: '401e24f', files }, null, 2));
const privateTarget = path.join(demo, '.env');
if (!fs.existsSync(privateTarget)) {
  const existing = fs.readFileSync(path.join(root, '.env.demo.local'), 'utf8');
  fs.writeFileSync(privateTarget, existing + '\nDEMO_ENV_FILE=.env\n', { mode: 0o600, flag: 'wx' });
}
console.log(JSON.stringify({ files: files.length, updated: changed, privateEnvironment: 'preserved', note: 'No DB/media operation; review release-manifest.json before restart' }));
