const assert=require('node:assert/strict'),path=require('node:path');
exports.verify=async(page,fixture,root)=>{
 await page.goto(new URL('/dangky.html',page.url()).href);
 // Actual shared auth/client and controller, real Nest response. The mount is test-only.
 await page.evaluate(async credentials=>{
  const {AuthService}=await import('/src/services/AuthService.js');const {ManagementController}=await import('/src/modules/management/ManagementController.js');
  await AuthService.login(credentials);const profile=(await AuthService.profile()).data;
  const host=document.createElement('section');host.id='phase12-operations-qa';host.className='container';document.querySelector('main').replaceChildren(host);
  window.operationsQA=new ManagementController(host,profile);window.operationsQA.mount();await window.operationsQA.open('operations');
 },{email:fixture.root.email,password:fixture.root.password});
 const host=page.locator('#phase12-operations-qa');await host.getByRole('heading',{name:'Vận hành hệ thống'}).waitFor();
 assert.match(await host.textContent(),/PostgreSQL/);assert.match(await host.textContent(),/Sao lưu/);assert.match(await host.textContent(),/AI: usage/);
 for(const theme of ['light','dark']){
  await page.evaluate(t=>{document.documentElement.dataset.theme=t;window.scrollTo(0,0);},theme);
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(root,`docs/phase12-evidence/operations-${theme}.png`),animations:'disabled'});
 }
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(root,'docs/phase12-evidence/operations-mobile.png'),animations:'disabled'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.route('**/api/v1/admin/operations',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,message:'QA dependency unavailable'})}));
 await page.evaluate(()=>window.operationsQA.open('operations'));await host.getByRole('button',{name:'Thử tải lại',exact:true}).waitFor();await page.unroute('**/api/v1/admin/operations');
 await host.getByRole('button',{name:'Thử tải lại',exact:true}).click();await host.getByRole('heading',{name:'Vận hành hệ thống'}).waitFor();
 const studentHidden=await page.evaluate(async credentials=>{const {AuthService}=await import('/src/services/AuthService.js');const {managementSections}=await import('/src/services/ManagementService.js');await AuthService.logout();await AuthService.login(credentials);const profile=(await AuthService.profile()).data;return !managementSections(profile).some(x=>x[0]==='operations');},{email:fixture.student.email,password:fixture.student.password});assert.equal(studentHidden,true);
 return{realBackend:true,systemManagerPanel:true,studentHidden:true,lightDark:true,mobileNoOverflow:true,errorAndRetry:true};
};
