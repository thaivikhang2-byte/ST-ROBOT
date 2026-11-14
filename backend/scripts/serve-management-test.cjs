require('../test/setup-env.cjs'); // Hard guard: only named disposable local test databases.
require('ts-node/register');
const path=require('node:path'),fs=require('node:fs/promises'),express=require('express');
const {randomUUID}=require('node:crypto');
const {NestFactory}=require('@nestjs/core');
const {AppModule}=require('../src/app.module');
const {setupHttp}=require('../src/config/setup-http');
const {PrismaService}=require('../src/database/prisma.service');
const {AuthService}=require('../src/modules/auth/auth.service');
const {ApprovalService}=require('../src/modules/roles/approval.service');
const {QuizzesService}=require('../src/modules/quizzes/quizzes.service');
const {ProgressService}=require('../src/modules/progress/progress.service');
const {hashPassword}=require('../src/shared/utils/hash.util');
const {seed}=require('../prisma/seed');
(async()=>{
  const app=await NestFactory.create(AppModule,{logger:false});setupHttp(app);
  app.use('/src',express.static(path.resolve(__dirname,'../../frontend/src')));
  app.use(express.static(path.resolve(__dirname,'../../frontend/public')));
  await app.init();const db=app.get(PrismaService);await seed(db);
  async function fixture(name){const role=await db.role.findUniqueOrThrow({where:{name}}),password=randomUUID()+'-Test9!';
    const user=await db.user.create({data:{email:`${randomUUID()}@phase9-browser.test`,first_name:'QA',last_name:name,password_hash:await hashPassword(password),role_id:role.id,is_email_verified:true}});
    const login=await app.get(AuthService).login({email:user.email,password});
    const family=await db.refreshToken.findFirstOrThrow({where:{user_id:user.id,is_revoked:false}});
    return {...user,password,actor:{id:user.id,email:user.email,roleId:role.id,roleName:name,permissions:login.user.permissions,grants:login.user.roles,isActive:true,isEmailVerified:true,sessionId:family.family_id}};
  }
  const root=await fixture('superadmin'),teacher=await fixture('teacher'),student=await fixture('student');
  await db.user.createMany({data:Array.from({length:11},()=>({email:`${randomUUID()}@pagination.qa.test`,first_name:'Pagination',last_name:'QA',password_hash:student.password_hash,role_id:student.role_id,is_email_verified:true}))});
  const course=await db.course.create({data:{title:'QA Phase 9 · Robot cảm biến',slug:randomUUID(),description:'Dữ liệu kiểm thử riêng, không phải lớp học thật.',creator_id:teacher.id,status:'published'}});
  const lesson=await db.lesson.create({data:{course_id:course.id,title:'QA · Đọc cảm biến khoảng cách',content:'<p>Robot đo khoảng cách bằng cảm biến siêu âm và điều chỉnh tốc độ.</p>',status:'published'}});
  const quizzes=app.get(QuizzesService);
  let quiz=await quizzes.create({lessonId:lesson.id,title:'QA · Giải thích cảm biến',questions:[{text:'Giải thích nguyên tắc đo khoảng cách.',type:'open_ended',points:10,gradingRubric:'Nêu thời gian truyền sóng và vận tốc âm thanh.'}]},teacher.actor);
  quiz=await quizzes.update(quiz.id,{status:'published'},teacher.actor);
  await app.get(ProgressService).enroll(student.actor,course.id);
  const attempt=await quizzes.start(quiz.id,student.actor);
  await quizzes.submit(attempt.id,{answers:[{questionId:attempt.questions[0].id,text:'Đo thời gian sóng đi và về, nhân vận tốc và chia hai.'}]},student.actor);
  const approval=await app.get(ApprovalService).create({type:'TEACHER_APPLICATION',scopeType:'SYSTEM',reason:'Hồ sơ QA kiểm thử phê duyệt'},student.id);
  await app.listen(0,'127.0.0.1');const url=`http://127.0.0.1:${app.getHttpServer().address().port}`;
  await fs.writeFile(path.resolve(__dirname,'../.test-tmp/browser-phase9.json'),JSON.stringify({url,courseId:course.id,lessonId:lesson.id,attemptId:attempt.id,approvalId:approval.id,root:{id:root.id,email:root.email,password:root.password},teacher:{id:teacher.id,email:teacher.email,password:teacher.password},student:{id:student.id,email:student.email,password:student.password}}));
  for(const [name,user] of [['root',root],['teacher',teacher],['student',student]]){
    const script=`async () => { const user=${JSON.stringify({email:user.email,password:user.password})}; document.querySelector('#loginEmail').value=user.email; document.querySelector('#loginPassword').value=user.password; document.querySelector('#authLoginForm').requestSubmit(); const end=Date.now()+15000; while(Date.now()<end){ if(!document.querySelector('#management').hidden && document.querySelector('.management-panel')?.getAttribute('aria-busy')==='false') return {login:true,sections:[...document.querySelectorAll('[data-section]')].map(e=>e.textContent),text:document.querySelector('.management-panel').innerText.slice(0,1000)}; await new Promise(r=>setTimeout(r,100)); } return {login:false,error:document.querySelector('#loginStatus')?.textContent}; }`;
    await fs.writeFile(path.resolve(__dirname,`../.test-tmp/browser-phase9-${name}-login.js`),script);
  }
  console.log('Disposable Phase 9 QA server: '+url);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().finally(()=>process.exit()));
})().catch(error=>{console.error('Phase 9 browser fixture failed:',error.message?.replace(/postgresql:\/\/\S+/g,'[redacted]'));process.exitCode=1;});
