require('../test/setup-env.cjs');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const target=path.resolve(__dirname,'../prisma/migrations/20261026000000_adaptive_video');
if(fs.existsSync(target))throw Error('Refusing to overwrite migration');
const result=spawnSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','diff','--from-url',process.env.DATABASE_URL,'--to-schema-datamodel','prisma/schema.prisma','--script'],{encoding:'utf8'});
if(result.status!==0)throw Error('Disposable schema diff failed');
if(/DROP TABLE|DROP COLUMN|TRUNCATE/i.test(result.stdout))throw Error('Unexpected destructive migration');
fs.mkdirSync(target);
fs.writeFileSync(path.join(target,'migration.sql'),result.stdout+`
-- Server duration and position bounds also apply at API boundaries.
ALTER TABLE videos ADD CONSTRAINT video_completion_threshold CHECK (completion_percent BETWEEN 50 AND 100);
ALTER TABLE video_playback_progress ADD CONSTRAINT video_progress_nonnegative CHECK (position_seconds>=0 AND furthest_seconds>=0 AND watched_seconds>=0 AND version>=0);
CREATE INDEX video_processing_recovery ON videos(status,processing_lease) WHERE deleted_at IS NULL;
`);
console.log('Created additive Phase 10 migration');
