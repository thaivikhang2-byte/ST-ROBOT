require('../test/setup-env.cjs');
require('ts-node/register');
const {PrismaClient}=require('../dist/database/client');
const {spawnSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const path=require('node:path'),fs=require('node:fs');
const {seed}=require('../prisma/seed');
async function main(){
  const base=new URL(process.env.DATABASE_URL);
  if(base.hostname!=='127.0.0.1'||base.port!=='15432'||base.pathname!=='/st_robot_phase4_test')throw Error('Disposable database guard failed');
  const admin=new PrismaClient();
  const result=[];
  try{
    for(const upgrade of [false,true]){
      const name='st_robot_phase9_'+(upgrade?'upgrade_':'clean_')+Date.now();
      if(!/^st_robot_phase9_(upgrade|clean)_\d+$/.test(name))throw Error('Unsafe database identifier');
      // CREATE DATABASE has no Prisma model and cannot run inside a transaction; the identifier is generated and strictly constrained.
      await admin.$executeRawUnsafe('CREATE DATABASE "'+name+'"');
      const url=new URL(base);url.pathname='/'+name;
      const client=new PrismaClient({datasourceUrl:url.href});
      function deploy(schema='prisma/schema.prisma'){
        const processResult=spawnSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy','--schema',schema],{encoding:'utf8',env:{...process.env,DATABASE_URL:url.href}});
        if(processResult.status!==0)throw Error('Migration execution failed; credentials withheld');
      }
      try{
        const userId=randomUUID(),roleId=randomUUID();
        if(upgrade){
          deploy(path.resolve(__dirname,'../../.phase9-backup/baseline-20261025/backend/prisma/schema.prisma'));
          await client.$executeRaw`INSERT INTO roles(id,name,is_default,is_active,created_at,updated_at) VALUES (${roleId}::uuid,'student',true,true,NOW(),NOW())`;
          await client.$executeRaw`INSERT INTO users(id,email,password_hash,first_name,last_name,role_id,created_at,updated_at) VALUES (${userId}::uuid,'migration-preservation@phase9.test','migration-fixture-hash','Existing','Student',${roleId}::uuid,NOW(),NOW())`;
        }
        deploy();
        if(upgrade){const user=await client.user.findUniqueOrThrow({where:{id:userId},include:{role_assignments:true}});
          if(user.role_id!==roleId||user.password_hash!=='migration-fixture-hash'||!user.rbac_migrated||user.role_assignments.length!==1||user.role_assignments[0].role_id!==roleId)throw Error('Backfill failed to preserve legacy identity');}
        await seed(client);
        const before={roles:await client.role.count(),permissions:await client.permission.count(),links:await client.rolePermission.count()};
        await seed(client);
        const after={roles:await client.role.count(),permissions:await client.permission.count(),links:await client.rolePermission.count()};
        if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Seed is not idempotent');
        if(await client.role.count({where:{group:'MANAGER'}})!==2||await client.role.count({where:{group:'TEACHER'}})!==1)throw Error('Role groups not seeded correctly');
        if((await client.aiProvider.findUniqueOrThrow({where:{id:'anthropic'}})).type!=='anthropic')throw Error('Anthropic seed selected the wrong adapter type');
        if(!upgrade){
          const bootstrap=(recovery=false,authorized=false)=>spawnSync(process.execPath,[require.resolve('ts-node/dist/bin.js'),'scripts/bootstrap-admin.ts'],{encoding:'utf8',env:{...process.env,DATABASE_URL:url.href,ALLOW_INITIAL_ADMIN_BOOTSTRAP:'true',BOOTSTRAP_ADMIN_EMAIL:randomUUID()+'@bootstrap.phase9.test',BOOTSTRAP_ADMIN_PASSWORD:randomUUID()+'-QA!9',ALLOW_ADMIN_RECOVERY:authorized?'true':'false',BOOTSTRAP_RECOVERY_REASON:recovery?'Controlled recovery verification on an isolated disposable database':''}});
          if(bootstrap().status!==0)throw Error('Initial protected bootstrap failed');
          if(bootstrap(true,false).status===0)throw Error('Recovery accepted without explicit opt-in');
          if(bootstrap(true,true).status!==0)throw Error('Authorized recovery failed');
          const protectedUsers=await client.user.findMany({where:{role:{name:'superadmin'}},include:{role_assignments:true}});
          if(protectedUsers.length!==2||protectedUsers.some(u=>!u.rbac_migrated||u.role_assignments.length!==1))throw Error('Bootstrap assignments are inconsistent');
          if(await client.auditLog.count({where:{action:'user.bootstrap_recovery'}})!==1)throw Error('Recovery audit missing');
        }
        result.push({mode:upgrade?'upgrade with preserved identity':'clean',database:name,migrations:await client.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`,seed:after,status:'PASS'});
      }finally{await client.$disconnect();}
    }
    fs.writeFileSync(path.resolve(__dirname,'../.test-tmp/phase9-migrations.json'),JSON.stringify(result,null,2));
    console.log('PASS: clean + upgrade migrations; identity preserved; seed idempotent; protected bootstrap/recovery verified. Isolated databases retained for inspection.');
  }finally{await admin.$disconnect();}
}
main().catch(()=>{console.error('Phase 9 migration verification failed; no credentials logged.');process.exitCode=1;});
