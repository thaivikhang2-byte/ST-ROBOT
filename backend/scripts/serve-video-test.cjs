require('../test/setup-env.cjs');
if(process.argv.includes('--short-playback'))process.env.VIDEO_PLAYBACK_TTL_SECONDS='30';
require('ts-node/register');
const path=require('node:path'),fs=require('node:fs/promises'),express=require('express');
const {randomUUID}=require('node:crypto');
const {NestFactory}=require('@nestjs/core');
const {AppModule}=require('../src/app.module');
const {setupHttp}=require('../src/config/setup-http');
const {PrismaService}=require('../src/database/prisma.service');
const {hashPassword}=require('../src/shared/utils/hash.util');
const {seed}=require('../prisma/seed');
(async()=>{
 const app=await NestFactory.create(AppModule,{logger:false,rawBody:true});setupHttp(app);
 app.use('/src',express.static(path.resolve(__dirname,'../../frontend/src')));
 app.use('/qa/source-video',(_req,res)=>res.sendFile(path.resolve(__dirname,'../.test-tmp/phase10-source.mp4'),{dotfiles:'allow'}));
 app.use(express.static(path.resolve(__dirname,'../../frontend/public')));
 await app.init();const db=app.get(PrismaService);await seed(db);
 async function fixture(name){const role=await db.role.findUniqueOrThrow({where:{name}}),password=randomUUID()+'-Video10!';const user=await db.user.create({data:{email:randomUUID()+'@phase10-browser.test',first_name:'QA',last_name:name,role_id:role.id,password_hash:await hashPassword(password),is_email_verified:true}});return {id:user.id,email:user.email,password};}
 const prior=process.argv.includes('--reuse')?JSON.parse(await fs.readFile(path.resolve(__dirname,'../.test-tmp/browser-phase10.json'),'utf8')):null;
 const teacher=prior?.teacher??await fixture('teacher'),student=prior?.student??await fixture('student'),stranger=prior?.stranger??await fixture('student'),root=prior?.root??await fixture('superadmin');
 const course=prior?await db.course.findUniqueOrThrow({where:{id:prior.courseId}}):await db.course.create({data:{title:'QA Phase 10 · Video robot',slug:'phase10-'+randomUUID(),description:'Video test riêng, không phải khóa học thật.',creator_id:teacher.id,status:'published'}});
 const lesson=prior?await db.lesson.findUniqueOrThrow({where:{id:prior.lessonId}}):await db.lesson.create({data:{course_id:course.id,title:'QA · Video cảm biến',content:'<p>Đọc cảm biến và quan sát robot.</p>',status:'published'}});
 await db.enrollment.upsert({where:{user_id_course_id:{user_id:student.id,course_id:course.id}},create:{user_id:student.id,course_id:course.id},update:{}});
 await app.listen(prior?Number(new URL(prior.url).port):0,'127.0.0.1');const url=`http://127.0.0.1:${app.getHttpServer().address().port}`;
 await fs.writeFile(path.resolve(__dirname,'../.test-tmp/browser-phase10.json'),JSON.stringify({url,teacher,student,stranger,root,courseId:course.id,lessonId:lesson.id}));
 for(const [name,user] of Object.entries({teacher,student,stranger,root})){
  const management=`async()=>{const u=${JSON.stringify(user)};document.querySelector('#loginEmail').value=u.email;document.querySelector('#loginPassword').value=u.password;document.querySelector('#authLoginForm').requestSubmit();for(let i=0;i<100;i++){if(document.querySelector('.management-panel')&&document.querySelector('.management-panel').getAttribute('aria-busy')==='false')return {login:true};await new Promise(r=>setTimeout(r,100));}return {login:false};}`;
  await fs.writeFile(path.resolve(__dirname,`../.test-tmp/browser-phase10-${name}-login.js`),management);
  const learning=`async()=>{const u=${JSON.stringify(user)};const form=document.querySelector('[data-login]');form.elements.email.value=u.email;form.elements.password.value=u.password;form.requestSubmit();for(let i=0;i<100;i++){if(document.querySelector('#lessonVideos video'))return {login:true,video:true};await new Promise(r=>setTimeout(r,100));}return {login:document.querySelector('[data-login]').hidden,notice:document.querySelector('#notice').textContent,video:false};}`;
  await fs.writeFile(path.resolve(__dirname,`../.test-tmp/browser-phase10-${name}-learning.js`),learning);
 }
 console.log('Disposable Phase 10 browser server: '+url);
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().finally(()=>process.exit()));
})().catch(()=>{console.error('Phase 10 QA server failed; credentials withheld');process.exitCode=1;});
