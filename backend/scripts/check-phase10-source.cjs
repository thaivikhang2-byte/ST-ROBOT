const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),baseline=path.resolve(root,'../.phase10-backup/baseline-20261026/backend');
if(!fs.existsSync(path.join(baseline,'src')))throw Error('Local baseline snapshot is required for this scoped comparison');
const files=[];
function walk(folder){for(const item of fs.readdirSync(folder,{withFileTypes:true})){const full=path.join(folder,item.name);if(item.isDirectory())walk(full);else if(item.name.endsWith('.ts')){const relative=path.relative(root,full),old=path.join(baseline,relative);if(!fs.existsSync(old)||!fs.readFileSync(old).equals(fs.readFileSync(full)))files.push(relative);}}}
walk(path.join(root,'src'));files.push('test/phase10-video.e2e-spec.ts');
if(files.length<2)throw Error('No Phase 10 source changes found');
for(const [pkg,bin,args] of [['prettier','bin/prettier.cjs',['--check',...files]],['eslint','bin/eslint.js',[...files,'--format','json','--output-file','.test-tmp/phase10-target-eslint.json']]]){
 const result=spawnSync(process.execPath,[path.join(path.dirname(require.resolve(pkg+'/package.json')),bin),...args],{cwd:root,stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);
}
console.log('PASS: Prettier + ESLint on '+files.length+' changed/new production and Phase 10 E2E files');
