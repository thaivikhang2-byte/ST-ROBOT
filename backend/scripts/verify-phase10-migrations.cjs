require('../test/setup-env.cjs');
require('ts-node/register');
const {PrismaClient}=require('../dist/database/client');
const {spawnSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const path=require('node:path'),fs=require('node:fs');
const {seed}=require('../prisma/seed');
(async()=>{
 const base=new URL(process.env.DATABASE_URL);
 if(base.hostname!=='127.0.0.1'||base.port!=='15432'||base.pathname!=='/st_robot_phase4_test')throw Error('Test database guard rejected');
 const admin=new PrismaClient();const results=[];
 try{
  for(const upgrade of [false,true]){
   const name='st_robot_phase10_'+(upgrade?'upgrade_':'clean_')+Date.now();
   if(!/^st_robot_phase10_(upgrade|clean)_\d+$/.test(name))throw Error('Unsafe identifier');
   // PostgreSQL CREATE DATABASE has no Prisma model and cannot be parametrized; identifier is generated and constrained.
   await admin.$executeRawUnsafe('CREATE DATABASE "'+name+'"');
   const url=new URL(base);url.pathname='/'+name;
   const client=new PrismaClient({datasourceUrl:url.href});
   const deploy=(schema='prisma/schema.prisma')=>{const r=spawnSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy','--schema',schema],{encoding:'utf8',env:{...process.env,DATABASE_URL:url.href}});if(r.status!==0)throw Error('Migration failed; connection details withheld');};
   const ids={role:randomUUID(),user:randomUUID(),course:randomUUID(),lesson:randomUUID(),video:randomUUID(),session:randomUUID()};
   try{
    if(upgrade){
     deploy(path.resolve(__dirname,'../../.phase10-backup/baseline-20261026/backend/prisma/schema.prisma'));
     // Use the previous schema columns explicitly so preservation is verified before new columns exist.
     await client.$executeRaw`INSERT INTO roles(id,name,created_at,updated_at) VALUES (${ids.role}::uuid,'preserved-student',NOW(),NOW())`;
     await client.$executeRaw`INSERT INTO users(id,email,password_hash,first_name,last_name,role_id,created_at,updated_at) VALUES (${ids.user}::uuid,'preserve@phase10.test','preserved-hash','Prior','Student',${ids.role}::uuid,NOW(),NOW())`;
     await client.$executeRaw`INSERT INTO courses(id,title,slug,creator_id,created_at,updated_at) VALUES (${ids.course}::uuid,'Prior course','prior-course',${ids.user}::uuid,NOW(),NOW())`;
     await client.$executeRaw`INSERT INTO lessons(id,title,course_id,created_at,updated_at) VALUES (${ids.lesson}::uuid,'Prior lesson',${ids.course}::uuid,NOW(),NOW())`;
     await client.$executeRaw`INSERT INTO videos(id,title,lesson_id,storage_key,status,created_at,updated_at) VALUES (${ids.video}::uuid,'Prior MP4',${ids.lesson}::uuid,'private/prior.mp4','ready',NOW(),NOW())`;
     await client.$executeRaw`INSERT INTO video_sessions(id,video_id,user_id,session_token,last_position,expires_at,created_at,updated_at) VALUES (${ids.session}::uuid,${ids.video}::uuid,${ids.user}::uuid,'prior-session',37,NOW()+INTERVAL '1 day',NOW(),NOW())`;
    }
    deploy();
    if(upgrade){const v=await client.video.findUniqueOrThrow({where:{id:ids.video},include:{sessions:true}});if(v.provider!=='legacy'||v.storage_key!=='private/prior.mp4'||v.sessions[0]?.last_position!==37)throw Error('Legacy video/session preservation failed');if((await client.user.findUniqueOrThrow({where:{id:ids.user}})).password_hash!=='preserved-hash')throw Error('Identity changed');}
    await seed(client);const count=await client.rolePermission.count();await seed(client);if(count!==await client.rolePermission.count())throw Error('Seed not idempotent');
    const migrations=await client.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`;
    results.push({mode:upgrade?'upgrade with preserved identity/video/session':'clean',database:name,migrationCount:migrations.length,status:'PASS'});
   }finally{await client.$disconnect();}
  }
  fs.writeFileSync(path.resolve(__dirname,'../.test-tmp/phase10-migrations.json'),JSON.stringify(results,null,2));
  console.log('PASS: clean + upgrade, legacy video/session/identity preserved, seed idempotent; test databases retained');
 }finally{await admin.$disconnect();}
})().catch(()=>{console.error('Phase 10 migration verification failed; credentials withheld');process.exitCode=1;});
