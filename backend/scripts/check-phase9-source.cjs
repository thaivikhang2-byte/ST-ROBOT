const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),baseline=path.resolve(root,'../.phase9-backup/baseline-20261025/backend');
const files=[];
function walk(folder){for(const item of fs.readdirSync(folder,{withFileTypes:true})){const full=path.join(folder,item.name);if(item.isDirectory())walk(full);else if(item.name.endsWith('.ts')){const relative=path.relative(root,full),old=path.join(baseline,relative);if(!fs.existsSync(old)||!fs.readFileSync(old).equals(fs.readFileSync(full)))files.push(relative);}}}
walk(path.join(root,'src'));
files.push('test/phase9-management.e2e-spec.ts');
function run(pkg,bin,args){const result=spawnSync(process.execPath,[path.join(path.dirname(require.resolve(pkg+'/package.json')),bin),...args],{cwd:root,stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);}
run('prettier','bin/prettier.cjs',['--write',...files]);
run('eslint','bin/eslint.js',[...files,'--format','json','--output-file','.test-tmp/phase9-target-eslint.json']);
console.log('PASS: ESLint on '+files.length+' changed/new production and Phase 9 test files');
