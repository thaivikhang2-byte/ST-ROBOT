import {createBenchUI, round} from './BenchUI.js';

export const DIRECTIONS = [{x:1,y:0,name:'đông',arrow:'→'},{x:0,y:1,name:'nam',arrow:'↓'},{x:-1,y:0,name:'tây',arrow:'←'},{x:0,y:-1,name:'bắc',arrow:'↑'}];
const pointKey = p => `${p.x},${p.y}`;
export function parseRoute(source) {
    const tokens = source.toUpperCase().split(/[\s,;]+/).filter(Boolean);
    if (!tokens.length || tokens.length > 120 || tokens.some(t => !['F','L','R'].includes(t))) throw new Error('Nhập 1–120 lệnh F (tiến), L (rẽ trái), R (rẽ phải), cách nhau bằng dấu phẩy hoặc khoảng trắng.');
    return tokens;
}
export function gridStep(state, command, {width = 5, height = 4, walls = []} = {}) {
    const next = {...state, blocked:false, reason:''};
    if (command === 'L' || command === 'R') {next.heading=(state.heading+(command==='R'?1:3))%4;next.turns=(state.turns||0)+1;}
    else if(command==='F') {
        const direction=DIRECTIONS[state.heading], x=state.x+direction.x,y=state.y+direction.y;
        if(x<0||y<0||x>=width||y>=height||walls.includes(`${x},${y}`)) {next.blocked=true;next.reason=x<0||y<0||x>=width||y>=height?'ra ngoài biên':'ô vật cản';}
        else {next.x=x;next.y=y;next.forwards=(state.forwards||0)+1;}
    } else throw new Error('Lệnh không hợp lệ.');
    return next;
}
export function runRoute(commands, options = {}) {
    let state={x:0,y:0,heading:0,forwards:0,turns:0,...options.start};
    const trace=[];
    for (const command of commands) {state=gridStep(state,command,options);trace.push({...state,command});if(state.blocked)break;}
    return {state,trace,complete:trace.length===commands.length&&!state.blocked};
}
export function wheelOdometry(distance, diameter, motorRatio = 1) {
    if (!(diameter > 0) || distance < 0 || motorRatio <= 0) throw new Error('Đường kính và tỷ số truyền phải dương; quãng đường không âm.');
    const circumference=Math.PI*diameter,turns=distance/circumference;
    return {circumference,turns,degrees:turns*360,motorTurns:turns*motorRatio};
}
export function proportionalControl(target, measured, speed, gain) {
    const error=((target-measured+180)%360+360)%360-180,correction=gain*error;
    const clamp=v=>Math.max(-100,Math.min(100,v));
    return {error,correction,left:clamp(speed-correction),right:clamp(speed+correction),saturated:Math.abs(speed-correction)>100||Math.abs(speed+correction)>100};
}
export function createSearch({width=4,height=3,walls=[],start={x:0,y:0},goal={x:3,y:2}}={}) {
    return {width,height,walls:[...walls],start:{...start},goal:{...goal},queue:[{...start}],visited:[pointKey(start)],parents:{},current:null,path:[],done:false,found:false,expanded:0};
}
export function stepSearch(previous) {
    if(previous.done)return previous;
    const state={...previous,queue:[...previous.queue],visited:[...previous.visited],parents:{...previous.parents}};
    if(!state.queue.length) return {...state,done:true,found:false};
    const current=state.queue.shift();state.current=current;state.expanded++;
    if(pointKey(current)===pointKey(state.goal)) {
        state.done=true;state.found=true;let key=pointKey(current);const reverse=[];
        while(key!==undefined){const [x,y]=key.split(',').map(Number);reverse.push({x,y});key=state.parents[key];}
        state.path=reverse.reverse();return state;
    }
    for(const direction of DIRECTIONS){const p={x:current.x+direction.x,y:current.y+direction.y},key=pointKey(p);if(p.x<0||p.y<0||p.x>=state.width||p.y>=state.height||state.walls.includes(key)||state.visited.includes(key))continue;state.visited.push(key);state.parents[key]=pointKey(current);state.queue.push(p);}
    if(!state.queue.length)state.done=true;
    return state;
}
export function shortestPath(options) {
    let search=createSearch(options);
    while(!search.done)search=stepSearch(search);
    return search.found?search.path:null;
}
export function pathCommands(path, heading=0) {
    const commands=[];
    for(let i=1;i<path.length;i++){
        const dx=path[i].x-path[i-1].x,dy=path[i].y-path[i-1].y,target=DIRECTIONS.findIndex(d=>d.x===dx&&d.y===dy);
        let turns=(target-heading+4)%4;
        if(turns===3)commands.push('L');else while(turns-->0)commands.push('R');
        commands.push('F');heading=target;
    }
    return commands;
}
/** Same declared full-map search as the lesson sample: enqueue once, FIFO/LIFO. */
export function searchWithFrontier({width=5,height=4,walls=[],start={x:0,y:0},goal={x:4,y:3},mode='BFS',limit=100}={}) {
    if (!['BFS','DFS'].includes(mode) || !Number.isInteger(limit) || limit < 1) throw new Error('Chọn BFS/DFS và ngân sách mở rộng nguyên dương.');
    const frontier=[{...start}],parents=new Map([[pointKey(start),null]]),blocked=new Set(walls);
    let expanded=0;
    while(frontier.length && expanded<limit) {
        const current=mode==='BFS'?frontier.shift():frontier.pop();expanded++;
        if(pointKey(current)===pointKey(goal)) {
            const path=[];let key=pointKey(current);
            while(key!==null){const [x,y]=key.split(',').map(Number);path.push({x,y});key=parents.get(key);}
            return {path:path.reverse(),expanded,reason:'goal_reached'};
        }
        for(const direction of DIRECTIONS) {
            const next={x:current.x+direction.x,y:current.y+direction.y},key=pointKey(next);
            if(next.x<0||next.y<0||next.x>=width||next.y>=height||blocked.has(key)||parents.has(key))continue;
            parents.set(key,pointKey(current));frontier.push(next);
        }
    }
    return {path:null,expanded,reason:frontier.length?'expansion_limit':'no_path'};
}
export const EXPERIMENT_MAPS=Object.freeze([
    Object.freeze({name:'Sân 1: trống',walls:Object.freeze([])}),
    Object.freeze({name:'Sân 2: tường ngắn',walls:Object.freeze(['1,0','1,1','1,2'])}),
    Object.freeze({name:'Sân 3: vách kín',walls:Object.freeze(['2,0','2,1','2,2','2,3'])})
]);

export function reactiveTrial({width=5,height=4,walls=[],goal={x:3,y:2},limit=40}={}) {
    let state={x:0,y:0,heading:0,forwards:0,turns:0};const commands=[];
    for(let i=0;i<limit;i++){
        if(state.x===goal.x&&state.y===goal.y)return {success:true,commands,state};
        const probe=gridStep(state,'F',{width,height,walls}),command=probe.blocked?'R':'F';
        commands.push(command);state=gridStep(state,command,{width,height,walls});
    }
    return {success:state.x===goal.x&&state.y===goal.y,commands,state};
}

function drawGrid(ui,{width=5,height=4,walls=[],state=null,goal=null,visited=[],path=[],onCell}) {
    ui.visual.replaceChildren();
    const grid=ui.make('div',undefined,'lesson-bench-grid');
    grid.style.gridTemplateColumns=`repeat(${width}, minmax(0, 1fr))`;
    grid.setAttribute('role','group');grid.setAttribute('aria-label','Lưới tọa độ; x tăng sang phải, y tăng xuống dưới');
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const key=`${x},${y}`,wall=walls.includes(key),robot=state&&state.x===x&&state.y===y,target=goal&&goal.x===x&&goal.y===y;
        const content=robot?DIRECTIONS[state.heading].arrow:wall?'■':target?'ĐÍCH':path.some(p=>p.x===x&&p.y===y)?'●':visited.includes(key)?'·':'';
        const cell=ui.make(onCell?'button':'div',undefined,'lesson-bench-cell');
        if(onCell){cell.type='button';cell.addEventListener('click',()=>onCell(x,y));}
        cell.classList.toggle('is-wall',wall);cell.classList.toggle('is-robot',Boolean(robot));cell.classList.toggle('is-goal',target);
        cell.append(ui.make('small',`(${x},${y})`),ui.make('strong',content));
        cell.setAttribute('aria-label',`Ô ${x}, ${y}${wall?', vật cản':''}${target?', đích':''}${robot?`, robot hướng ${DIRECTIONS[state.heading].name}`:''}`);
        grid.append(cell);
    }
    ui.visual.append(grid,ui.make('p','Quy ước: x sang phải, y xuống dưới. F = tiến 1 ô; L/R chỉ quay 90°. Mô hình rời rạc không đo motor, trượt bánh hay thời gian robot thật.','lesson-bench-note'));
}
function mountRoute(ui, lesson, course) {
    const loop=lesson.id==='loop',challenge=lesson.id==='challenge',drive=lesson.id==='drive',hasGoal=challenge||lesson.id==='mission';
    const gridGoal=hasGoal?{x:3,y:2}:null;
    ui.note(loop?'Dự đoán cả vị trí và hướng. So sánh thân lặp F,R với F rồi rẽ một lần ngoài vòng lặp.':challenge?'Dự đoán tuyến nào đến (3,2), rồi tính chi phí với cùng tF, tR. Chỉ so chi phí của các tuyến đến đúng đích.':drive?'Chương trình → Brain → lệnh hai motor → bánh xe → chuyển động. Trên lưới, một F là một ô lý tưởng; dự đoán F,F,F trước khi bước.':'Dự đoán (x,y,hướng) sau từng lệnh. Bắt đầu từ (0,0); kiểm tra cả hướng cuối, biên và đích.');
    const route=ui.field(loop?'Thân vòng lặp':'Tuyến lệnh F, L, R',loop?'F,R':drive?'F,F,F':lesson.id==='sequence'?'F,F,R,F':lesson.id==='turn'?'F,R,F':challenge?'F,R,F,L,F,F,R,F':'F,F,F,R,F,F',{multiline:true,maxLength:400});
    const heading=ui.field('Hướng khởi đầu','0',{choices:DIRECTIONS.map((d,i)=>({value:String(i),label:d.name}))});
    const count=loop?ui.field('Số lần lặp',4,{min:1,max:15,step:1}):null;
    const tail=loop?ui.field('Lệnh sau vòng lặp','',{type:'text',maxLength:30}):null;
    const tF=challenge?ui.field('Chi phí một tiến (s)',1,{min:0.01,max:100,step:0.1}):null;
    const tR=challenge?ui.field('Chi phí một rẽ (s)',3,{min:0.01,max:100,step:0.1}):null;
    let state={x:0,y:0,heading:0,forwards:0,turns:0},commands=[],cursor=0,source='',trace=[];
    const sourceText=()=>[route.value,heading.value,count?.value,tail?.value].join('|');
    const prepare=()=>{let list=parseRoute(route.value);if(loop){const n=ui.number(count,1,15);if(!Number.isInteger(n))throw new Error('Số lần lặp phải nguyên.');list=Array.from({length:n},()=>list).flat();if(tail.value.trim())list.push(...parseRoute(tail.value));if(list.length>120)throw new Error('Tuyến sau khai triển không quá 120 lệnh.');}return list;};
    const reset=()=>{state={x:0,y:0,heading:Number(heading.value),forwards:0,turns:0};commands=[];cursor=0;source='';trace=[];drawGrid(ui,{state,goal:gridGoal});};
    const report=()=>{
        const goal=state.x===3&&state.y===2;
        let text=`${trace.slice(-10).join('\n')}\nĐã xử lý ${cursor}/${commands.length} lệnh; ${state.forwards} tiến, ${state.turns} rẽ.\nTrạng thái (${state.x},${state.y},${DIRECTIONS[state.heading].name}).${hasGoal?` ${goal?'Đã tới đích (3,2).':'Chưa tới đích (3,2).'}`:''}`;
        if(challenge){const cost=state.forwards*ui.number(tF,0.01,100)+state.turns*ui.number(tR,0.01,100);text+=`\nChi phí đã thực hiện = ${round(cost)} s theo mô hình${goal?'':'; chưa đủ điều kiện chọn tuyến'}.`;}
        ui.report(text);
    };
    const step=()=>{
        if(challenge){ui.number(tF,0.01,100);ui.number(tR,0.01,100);}
        if(!commands.length){commands=prepare();source=sourceText();state.heading=Number(heading.value);}
        if(source!==sourceText())throw new Error('Tuyến/hướng đã đổi. Đặt lại rồi thử để giữ điều kiện đầu nhất quán.');
        if(cursor>=commands.length||state.blocked)throw new Error('Lượt chạy đã dừng. Đặt lại trước lượt mới.');
        const command=commands[cursor++];state=gridStep(state,command);
        trace.push(`${cursor}. ${command} → (${state.x},${state.y},${DIRECTIONS[state.heading].name})${state.blocked?`; DỪNG: ${state.reason}`:''}`);
        drawGrid(ui,{state,goal:gridGoal});report();
    };
    ui.button('Bước một lệnh',ui.guard(step));
    ui.button('Chạy hết từ đầu',ui.guard(()=>{const list=prepare();if(challenge){ui.number(tF,0.01,100);ui.number(tR,0.01,100);}reset();commands=list;source=sourceText();for(const command of commands){cursor++;state=gridStep(state,command);trace.push(`${cursor}. ${command} → (${state.x},${state.y},${DIRECTIONS[state.heading].name})${state.blocked?`; DỪNG: ${state.reason}`:''}`);if(state.blocked)break;}drawGrid(ui,{state,goal:gridGoal});report();}));
    if(challenge){ui.button('Nạp tuyến A',()=>{route.value='F,R,F,L,F,F,R,F';reset();ui.report('Đã nạp A và về điểm đầu; hãy chạy tuyến.',false);});ui.button('Nạp tuyến B',()=>{route.value='F,F,F,F,R,F,F,R,F';reset();ui.report('Đã nạp B và về điểm đầu; hãy chạy tuyến.',false);});}
    ui.button('Đặt lại điểm đầu',()=>{reset();ui.report('Đã về điểm đầu; chưa thực hiện lệnh mới.',false);});reset();
}
function mountThreshold(ui) {
    ui.note('Dự đoán 19,20,21 cm với điều kiện d < T. Đây là quyết định số học, không đo phanh hay khoảng cách cảm biến thật. Dữ liệu lỗi luôn chọn dừng báo lỗi.');
    const distance=ui.field('Khoảng cách (cm)',19,{min:0,max:255,step:0.1});
    const threshold=ui.field('Ngưỡng T (cm)',20,{min:1,max:255,step:1});
    const valid=ui.field('Dữ liệu','valid',{choices:[{value:'valid',label:'Hợp lệ'},{value:'invalid',label:'Không hợp lệ'}]});
    const comparison=ui.field('Điều kiện dừng','<',{choices:['<','<=']});
    ui.button('Kiểm tra quyết định',ui.guard(()=>{const d=ui.number(distance,0,255),t=ui.number(threshold,1,255);const good=valid.value==='valid'&&d>0;const stop=comparison.value==='<'?d<t:d<=t;ui.report(good?`${d} cm = ${d*10} mm; T = ${t} cm = ${t*10} mm.\nd ${comparison.value} T là ${stop?'đúng':'sai'} → ${stop?'DỪNG':'TIẾN CHẬM'}.\nĐổi đơn vị cả hai vế không đổi nhánh. Lệnh dừng không có nghĩa robot đứng yên ngay.`:'Dữ liệu không hợp lệ → DỪNG và BÁO LỖI. Không thay bằng một khoảng cách giả.');}));
    ui.button('Đặt lại',()=>{distance.value='19';threshold.value='20';valid.value='valid';comparison.value='<';ui.report('Đã đặt lại ca 19 cm; chưa thử lại.',false);});
}
function mountAvoid(ui) {
    ui.note('Quy tắc: mẫu hợp lệ và d < 20 cm → rẽ phải; ngược lại tiến; lỗi → dừng. Trước mỗi bước hãy dự đoán hướng. Sân có góc cụt; luật cục bộ này không bảo đảm tìm được đích.');
    const valid=ui.field('Cảm biến','valid',{choices:[{value:'valid',label:'Hợp lệ'},{value:'invalid',label:'Lỗi dữ liệu'}]});
    const walls=['2,0','2,1','2,2','1,2','0,2'],goal={x:4,y:0};
    let state,steps,seen,trace;
    const reset=()=>{state={x:1,y:1,heading:0,forwards:0,turns:0};steps=0;seen=new Set();trace=[];drawGrid(ui,{state,walls,goal});};
    ui.button('Đo lại và bước quyết định',ui.guard(()=>{
        if(steps>=20)throw new Error('Đã chạm giới hạn 20 hành động: chưa hoàn thành. Đặt lại để thử lại.');
        if(state.x===goal.x&&state.y===goal.y)throw new Error('Đã tới đích; đặt lại cho lượt mới.');
        if(valid.value==='invalid'){ui.report('SENSOR_ERROR → dừng; không cập nhật vị trí.');return;}
        const probe=gridStep(state,'F',{walls}),distance=probe.blocked?10:100,command=distance<20?'R':'F';
        state=gridStep(state,command,{walls});steps++;
        const key=`${state.x},${state.y},${state.heading}`,repeat=seen.has(key);seen.add(key);
        trace.push(`${steps}. d mô hình = ${distance} cm → ${command} → (${state.x},${state.y},${DIRECTIONS[state.heading].name})`);
        drawGrid(ui,{state,walls,goal});ui.report(`${trace.slice(-8).join('\n')}\n${state.x===goal.x&&state.y===goal.y?'Đã tới đích.':steps>=20?'Hết 20 hành động: chưa hoàn thành.':repeat?'Lặp lại vị trí và hướng. Cần nhớ trạng thái hoặc lập đường đi.':'Chưa tới đích; phải đo lại trước bước sau.'}\nKhoảng cách 10/100 cm là tín hiệu giả định từ ô trước mặt, không là vật lý cảm biến.`);
    }));
    ui.button('Đặt lại sân',()=>{reset();ui.report('Đã về (1,1,đông); chưa bước.',false);});reset();
}
function mountOdometry(ui) {
    ui.note('Dự đoán số vòng khi tăng gấp đôi quãng đường hoặc đường kính. Truyền trực tiếp có tỷ số motor/bánh = 1; số liệu ba lượt dưới đây là dữ liệu nhập, không đo tự động.');
    const distance=ui.field('Quãng đường yêu cầu (mm)',500,{min:0,max:10000,step:10}),diameter=ui.field('Đường kính bánh (mm)',56,{min:1,max:500,step:1}),ratio=ui.field('Vòng motor / một vòng bánh',1,{min:0.01,max:100,step:0.1}),measures=ui.field('Ba lượt đo khi yêu cầu 500 mm','478,480,482',{type:'text',maxLength:100});
    ui.button('Tính vòng bánh và kiểm tra hiệu chuẩn',ui.guard(()=>{const d=ui.number(distance,0,10000),D=ui.number(diameter,1,500),r=ui.number(ratio,0.01,100),result=wheelOdometry(d,D,r),samples=measures.value.split(/[,;\s]+/).filter(Boolean).map(Number);if(samples.length!==3||samples.some(s=>!Number.isFinite(s)||s<=0||s>10000))throw new Error('Nhập ba quãng đường đo hợp lệ, lớn hơn 0 mm.');const average=samples.reduce((a,b)=>a+b,0)/3;ui.report(`C = πD = ${round(result.circumference)} mm.\nn = s/C = ${round(result.turns,3)} vòng bánh; θ = ${round(result.degrees,1)}°; motor = ${round(result.motorTurns,3)} vòng.\nBa lượt yêu cầu 500 mm: trung bình ${round(average)} mm. Hệ số thử = 500/${round(average)} = ${round(500/average,4)}.\nCần thử lại trên dữ liệu mới, cùng tốc độ/mặt sàn; phép tính không xác nhận độ trượt thực.`);}));
    ui.button('Đặt lại',()=>{distance.value='500';diameter.value='56';ratio.value='1';measures.value='478,480,482';ui.report('Đã phục hồi thông số; chưa tính lại.',false);});
}
function mountControl(ui) {
    ui.note('Quy ước góc tăng ngược chiều kim đồng hồ. Dự đoán chiều rẽ khi góc đo +20°, mục tiêu 0°. Đây là một lần tính điều khiển P, không phải mô phỏng ổn định hệ kín hoặc PID.');
    const target=ui.field('Góc mục tiêu (°)',0,{min:-360,max:360,step:1}),measured=ui.field('Góc đo (°)',20,{min:-360,max:360,step:1}),speed=ui.field('Tốc độ cơ sở (%)',30,{min:0,max:100,step:1}),gain=ui.field('Kp (điểm %/độ)',0.5,{min:0,max:20,step:0.1});
    ui.button('Tính một lần phản hồi',ui.guard(()=>{const result=proportionalControl(ui.number(target,-360,360),ui.number(measured,-360,360),ui.number(speed,0,100),ui.number(gain,0,20));ui.report(`e ngắn nhất = ${round(result.error)}°; u = Kp·e = ${round(result.correction)} điểm %.\nLệnh trái = ${round(result.left)}%; phải = ${round(result.right)}% (giới hạn −100..100%).\nXu hướng lý tưởng: ${result.right>result.left?'rẽ trái':result.right<result.left?'rẽ phải':'đi thẳng'}. ${result.saturated?'Có bão hòa lệnh. ':''}Clamp không chứng minh hệ ổn định; chưa có I, D, độ trễ hay động lực học.`);}));
    ui.button('Đặt lại',()=>{target.value='0';measured.value='20';speed.value='30';gain.value='0.5';ui.report('Đã phục hồi ca +20°; chưa tính lại.',false);});
}
function mountSearch(ui) {
    ui.note('Dự đoán đường từ (0,0) đến (3,2). Bấm ô để thêm/bỏ tường (trừ đầu/đích); mỗi bước BFS lấy đầu hàng đợi FIFO và thăm láng giềng đông,nam,tây,bắc. Tất cả cạnh có cùng chi phí 1; không tối ưu giá rẽ.');
    let walls=['1,0','1,1'],search=createSearch({walls});
    const draw=()=>drawGrid(ui,{width:4,height:3,walls,goal:{x:3,y:2},visited:search.visited,path:search.path,onCell:(x,y)=>{if((x===0&&y===0)||(x===3&&y===2))return;const key=`${x},${y}`;walls=walls.includes(key)?walls.filter(k=>k!==key):[...walls,key];search=createSearch({walls});draw();ui.report('Đã đổi sân; tìm kiếm về đầu. Dự đoán lại rồi bước BFS.',false);}});
    const report=()=>ui.report(`Lấy ra: ${search.current?pointKey(search.current):'chưa có'}; đã mở rộng ${search.expanded} ô.\nHàng đợi: ${search.queue.map(pointKey).join(' → ')||'(rỗng)'}.\nĐã phát hiện ${search.visited.length} ô.\n${search.found?`Đường ngắn nhất: ${search.path.map(pointKey).join(' → ')}; ${search.path.length-1} bước.`:search.done?'NO_PATH: không có đường đi.':'Chưa kết luận; tiếp tục lấy đầu hàng đợi.'}`);
    ui.button('Bước BFS: lấy đầu hàng đợi',ui.guard(()=>{if(search.done)throw new Error('Đã kết thúc; đặt lại tìm kiếm cho lượt mới.');search=stepSearch(search);draw();report();}));
    ui.button('Tìm đến khi kết thúc',()=>{if(search.done){ui.report('Đã kết thúc; đặt lại trước lượt mới.',false);return;}while(!search.done)search=stepSearch(search);draw();report();});
    ui.button('Đặt lại tìm kiếm',()=>{search=createSearch({walls});draw();ui.report('Đã đặt lại hàng đợi: (0,0); chưa duyệt.',false);});
    ui.button('Phục hồi sân mẫu',()=>{walls=['1,0','1,1'];search=createSearch({walls});draw();ui.report('Đã khôi phục hai tường tại (1,0),(1,1); chưa duyệt.',false);});draw();
}
function mountExperiment(ui) {
    ui.note('Chốt chi phí trước khi chạy. BFS và DFS cùng biết toàn bản đồ, cùng thứ tự xét láng giềng đông,nam,tây,bắc. Cùng ba sân 5×4, đầu (0,0,đông), đích (4,3) và ngân sách mở rộng ô. BFS lấy đầu hàng đợi; DFS lấy cuối ngăn xếp.');
    const tF=ui.field('Chi phí tiến (s)',1,{min:0.01,max:10,step:0.1}),tR=ui.field('Chi phí rẽ (s)',0.5,{min:0.01,max:10,step:0.1});
    const limit=ui.field('Giới hạn số ô được mở rộng',100,{min:1,max:1000,step:1});
    ui.button('Chạy BFS và DFS trên cùng ba sân',ui.guard(()=>{
        const forwardCost=ui.number(tF,0.01,10),turnCost=ui.number(tR,0.01,10),budget=ui.number(limit,1,1000);
        if(!Number.isInteger(budget))throw new Error('Giới hạn mở rộng phải là số nguyên.');
        const results={BFS:[],DFS:[]},lines=[];
        for(const scene of EXPERIMENT_MAPS)for(const mode of ['BFS','DFS']) {
            const result=searchWithFrontier({walls:scene.walls,mode,limit:budget});
            if(result.path) {
                const commands=pathCommands(result.path),forwards=commands.filter(c=>c==='F').length,turns=commands.length-forwards,cost=forwards*forwardCost+turns*turnCost;
                results[mode].push({success:true,cost});
                lines.push(`${scene.name} · ${mode}: đến đích; ${forwards} tiến/${turns} rẽ; ${round(cost)} s chi phí mô hình; mở rộng ${result.expanded} ô.`);
            } else {
                results[mode].push({success:false});
                lines.push(`${scene.name} · ${mode}: ${result.reason==='no_path'?'NO_PATH: không có đường đi':'EXPANSION_LIMIT: hết ngân sách'}; mở rộng ${result.expanded} ô; chưa hoàn thành, không có chi phí tuyến thành công.`);
            }
        }
        for(const mode of ['BFS','DFS']) {
            const valid=results[mode].filter(r=>r.success);
            lines.push(`${mode}: hoàn thành ${valid.length}/3 (${round(100*valid.length/3)}%); trung bình chi phí trên lượt thành công = ${valid.length?round(valid.reduce((sum,row)=>sum+row.cost,0)/valid.length)+' s':'không có'}.`);
        }
        lines.push('Giữ cả NO_PATH/hết ngân sách trong tỷ lệ hoàn thành. Giây là chi phí tiến/rẽ được khai báo; chưa tính thời gian tìm kiếm và không là số đo robot. BFS tối ưu số bước với cạnh đồng giá, chưa bảo đảm ít rẽ nhất.');
        ui.report(lines.join('\n'));
    }));
    ui.button('Đặt lại tiêu chí',()=>{tF.value='1';tR.value='0.5';limit.value='100';ui.report('Đã phục hồi cùng chi phí và ngân sách 100 ô; chưa chạy so sánh mới.',false);});
}

export function mountRobotBench({host,course,lesson,onEvidence}) {
    const ui=createBenchUI(host,onEvidence);
    if(['drive','turn','mission','sequence','loop','challenge'].includes(lesson.id))mountRoute(ui,lesson,course);
    else if(lesson.id==='detect')mountThreshold(ui);
    else if(lesson.id==='avoid')mountAvoid(ui);
    else if(lesson.id==='odometry')mountOdometry(ui);
    else if(lesson.id==='control')mountControl(ui);
    else if(lesson.id==='search')mountSearch(ui);
    else if(lesson.id==='experiment')mountExperiment(ui);
    else ui.note('Bài này chưa có mô hình phù hợp.');
    return {destroy(){host.replaceChildren();}};
}
