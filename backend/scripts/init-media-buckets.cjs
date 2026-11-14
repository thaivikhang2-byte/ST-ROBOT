const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { S3Client, HeadBucketCommand, CreateBucketCommand, GetBucketPolicyCommand } = require('@aws-sdk/client-s3');
const env = parseEnv(fs.readFileSync(path.resolve(__dirname, '../../.env.media.local'), 'utf8'));
if (env.S3_ENDPOINT !== 'http://127.0.0.1:19000' || env.S3_BUCKET !== 'st-robot-media-local') throw new Error('Refusing non-local storage setup');
const client = new S3Client({ endpoint: env.S3_ENDPOINT, region: env.S3_REGION, forcePathStyle: true,
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } });
(async () => {
  for (const Bucket of [env.S3_BUCKET, 'st-robot-phase6-test']) {
    try { await client.send(new HeadBucketCommand({ Bucket })); }
    catch (error) { if (error.$metadata?.httpStatusCode !== 404) throw error; await client.send(new CreateBucketCommand({ Bucket })); }
    // Never silently remove an existing policy. Require operator review if this bucket is not private.
    try { await client.send(new GetBucketPolicyCommand({ Bucket })); throw new Error('Existing bucket policy requires manual privacy review'); }
    catch (error) { if (error.name !== 'NoSuchBucketPolicy') throw error; }
  }
  fs.writeFileSync(path.resolve(__dirname, '../.test-tmp/media-services.json'), JSON.stringify({
    endpoint: env.S3_ENDPOINT, bucket: 'st-robot-phase6-test', region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  }), { mode: 0o600 });
  console.log('Local application and isolated test buckets ready; both have no public bucket policy.');
})().catch(() => { console.error('Local bucket initialization failed; no policy or existing object was changed.'); process.exitCode = 1; }).finally(() => client.destroy());
