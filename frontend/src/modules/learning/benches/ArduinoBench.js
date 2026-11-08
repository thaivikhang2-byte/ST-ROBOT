import {createBenchUI, round} from './BenchUI.js';

export function ledCircuit(resistance, closed = true, forward = true, supply = 5, drop = 2) {
    if (!(resistance > 0)) throw new Error('Điện trở phải lớn hơn 0 Ω.');
    const current = closed && forward ? Math.max(0, supply - drop) / resistance : 0;
    return {milliamps: current * 1000, watts: current * current * resistance};
}
export function blinkMetrics(on, off) {
    if (on < 0 || off < 0 || on + off <= 0) throw new Error('Tổng thời gian bật và tắt phải lớn hơn 0.');
    return {period: on + off, hz: 1000 / (on + off), duty: 100 * on / (on + off)};
}
export function echoDistance(microseconds) {
    return microseconds > 0 && microseconds <= 30000 ? microseconds * 0.034 / 2 : null;
}
export function thresholdAlarm(distance, threshold, valid = true, inclusive = false) {
    if (!valid) return {state: 'SENSOR_ERROR', led: true};
    const near = inclusive ? distance <= threshold : distance < threshold;
    return {state: near ? 'NEAR' : 'FAR', led: near};
}
export function hysteresisAlarm(previous, distance, valid = true, low = 20, high = 25) {
    if (!(low < high)) throw new Error('Ngưỡng bật phải nhỏ hơn ngưỡng tắt.');
    if (!valid) return {alarm: previous, led: true, state: 'SENSOR_ERROR'};
    const alarm = distance < low ? true : distance > high ? false : previous;
    return {alarm, led: alarm, state: alarm ? 'ON' : 'OFF'};
}
export function calibrateOffset(reference, measured, validationReference, validationMeasured) {
    if (!reference.length || reference.length !== measured.length) throw new Error('Cần hai danh sách có cùng số mẫu.');
    const errors = measured.map((v, i) => v - reference[i]);
    const offset = errors.reduce((sum, value) => sum + value, 0) / errors.length;
    const corrected = validationMeasured - offset;
    return {errors, offset, corrected, before: Math.abs(validationMeasured - validationReference), after: Math.abs(corrected - validationReference)};
}

export function mountArduinoBench({host, lesson, onEvidence}) {
    const ui = createBenchUI(host, onEvidence);
    const {field, button, note, report, number, guard, make, visual} = ui;
    const light = make('div', 'LED chưa thử', 'lesson-bench-lamp');
    visual.append(light);
    const showLight = on => { light.textContent = on ? '● LED sáng' : '○ LED tắt'; light.dataset.on = String(on); };
    if (lesson.id === 'led') {
        note('Dự đoán: đổi 330 Ω thành 1000 Ω thì dòng tăng hay giảm? Mô hình nguồn 5 V, LED rơi áp cố định 2 V; không mô phỏng đặc tuyến hay hỏng LED.');
        const resistance = field('Điện trở nối tiếp (Ω)', 330, {min: 1, max: 100000, step: 1});
        const closed = field('Đường dẫn', 'closed', {choices: [{value:'closed',label:'Mạch kín'}, {value:'open',label:'Mạch hở'}]});
        const polarity = field('Cực LED', 'forward', {choices:[{value:'forward',label:'Thuận chiều'}, {value:'reverse',label:'Ngược chiều'}]});
        button('Thử mạch', guard(() => {
            const r = number(resistance, 1, 100000);
            const result = ledCircuit(r, closed.value === 'closed', polarity.value === 'forward');
            showLight(result.milliamps > 0);
            report(`R = ${r} Ω; ${closed.value === 'closed' ? 'mạch kín' : 'mạch hở'}; ${polarity.value === 'forward' ? 'LED thuận' : 'LED ngược'}.\nI = ${round(result.milliamps)} mA; P điện trở = ${round(result.watts, 4)} W.\n${result.milliamps <= 10 ? 'Đáp ứng I ≤ 10 mA trong mô hình này.' : 'Vượt mục tiêu 10 mA của bài. Tăng điện trở và thử lại.'}`);
        }));
        button('Đặt lại mạch', () => {resistance.value='330';closed.value='closed';polarity.value='forward'; light.textContent='LED chưa thử'; report('Đã đặt lại. Chưa thực hiện lượt thử mới.',false);});
    } else if (lesson.id === 'timing') {
        note('Dự đoán T, f và phần trăm bật trước khi bước thời gian. Thử 250/750 ms cho 1 Hz, 25%; rồi đổi cả hai thời gian để được 2 Hz, 25%.');
        const on = field('Thời gian bật (ms)', 200, {min:0,max:10000,step:50});
        const off = field('Thời gian tắt (ms)', 800, {min:0,max:10000,step:50});
        const step = field('Mỗi bước thời gian (ms)',100,{min:1,max:10000,step:1});
        let elapsed = 0;
        const draw = () => {
            const a=number(on,0,10000), b=number(off,0,10000), m=blinkMetrics(a,b);
            const active = elapsed % m.period < a;
            showLight(active);
            visual.querySelector('svg')?.remove();
            const svg=ui.doc.createElementNS('http://www.w3.org/2000/svg','svg');
            svg.setAttribute('viewBox','0 0 500 70'); svg.setAttribute('role','img'); svg.setAttribute('aria-label',`Hai chu kỳ; LED bật ${round(m.duty)} phần trăm mỗi chu kỳ.`);
            for(let i=0;i<2;i++){const rect=ui.doc.createElementNS(svg.namespaceURI,'rect');rect.setAttribute('x',String(i*250));rect.setAttribute('y','15');rect.setAttribute('width',String(250*a/m.period));rect.setAttribute('height','30');rect.setAttribute('fill','#facc15');svg.append(rect);}
            visual.append(svg);
            report(`t = ${elapsed} ms; pha = ${round(elapsed % m.period)} ms: LED ${active?'sáng':'tắt'}.\nT = ${m.period} ms; f = ${round(m.hz,3)} Hz; D = ${round(m.duty)}%.\nMột thao tác trong loop có thể phải chờ phần delay còn lại; đây là bước thời gian mô hình, không chạy sketch.`,true);
        };
        button('Áp dụng nhịp từ t = 0',guard(()=>{elapsed=0;draw();}));
        button('Bước thời gian',guard(()=>{elapsed+=number(step,1,10000);draw();}));
        button('Đặt lại thời gian',()=>{elapsed=0;light.textContent='LED chưa thử';report('Đã về t = 0; bấm áp dụng để quan sát nhịp.',false);});
    } else if (lesson.id === 'distance') {
        note('Dự đoán khoảng cách cho Echo 1000 rồi 2000 µs. Âm thanh đi và về: d = t × 0,034 / 2. Nhập 0 để thử timeout; mô hình không tạo Echo từ vật thật.');
        const echo=field('Độ rộng Echo (µs; 0 = timeout)',1000,{min:0,max:50000,step:1});
        button('Đổi Echo thành khoảng cách',guard(()=>{const t=number(echo,0,50000),d=echoDistance(t); report(d===null?`Echo = ${t} µs: No echo / ngoài cửa sổ 30000 µs. Không có khoảng cách hợp lệ; không gán 0 cm.`:`Echo = ${t} µs → ${round(d)} cm.\nHai chặng âm thanh dài ${round(d*2)} cm. Giả định vận tốc 0,034 cm/µs.`);}));
        button('Đặt lại Echo',()=>{echo.value='1000';report('Echo về 1000 µs; chưa đo lại.',false);});
    } else if (lesson.id === 'alarm') {
        note('Dự đoán ba nhánh cho 19, 20, 21 cm và mất Echo. Chỉ thay một yếu tố mỗi lượt: dấu <, ngưỡng hoặc tính hợp lệ.');
        const distance=field('Khoảng cách (cm)',19,{min:0,max:500,step:0.1});
        const threshold=field('Ngưỡng (cm)',20,{min:1,max:500,step:1});
        const valid=field('Dữ liệu', 'valid',{choices:[{value:'valid',label:'Echo hợp lệ'},{value:'invalid',label:'Timeout / mất Echo'}]});
        const comparison=field('Điều kiện gần','<',{choices:['<','<=']});
        button('Kiểm tra một mẫu',guard(()=>{const d=number(distance,0,500),t=number(threshold,1,500),v=valid.value==='valid',result=thresholdAlarm(d,t,v,comparison.value==='<=');showLight(result.led);report(`${v?`d = ${d} cm; điều kiện d ${comparison.value} ${t} cm`:'Mất Echo; không có d hợp lệ'} → ${result.state}.\nLED ${result.led?'sáng':'tắt'}${v?'':'; sáng theo chính sách báo lỗi, không phải số đo gần'}.`);}));
        button('Đặt lại',()=>{distance.value='19';threshold.value='20';valid.value='valid';comparison.value='<';light.textContent='LED chưa thử';report('Đã khôi phục ngưỡng 20 cm, dấu <.',false);});
    } else if (lesson.id === 'calibration') {
        light.remove();
        note('Dự đoán offset từ ba cặp chuẩn–đo; chỉ dùng ba điểm này để học offset. Điểm 25 cm được giữ riêng để kiểm chứng. Dữ liệu nhập là giả định, không phải số đo cảm biến.');
        const samples=[10,20,30].map((ref,i)=>field(`Đo tại chuẩn ${ref} cm`,[11,21,31][i],{min:0,max:500,step:0.1}));
        const test=field('Mẫu mới tại chuẩn 25 cm',26.2,{min:0,max:500,step:0.1});
        button('Tính và kiểm chứng bù offset',guard(()=>{const measured=samples.map(x=>number(x,0,500)), result=calibrateOffset([10,20,30],measured,25,number(test,0,500));report(`Sai số đo − chuẩn: ${result.errors.map(x=>round(x)).join('; ')} cm.\nOffset trung bình = ${round(result.offset)} cm. Mẫu mới sau bù = ${round(result.corrected)} cm.\nSai số tuyệt đối: trước ${round(result.before)} cm → sau ${round(result.after)} cm.\n${result.after<result.before?'Mẫu kiểm chứng này tốt hơn.':result.after>result.before?'Bù làm mẫu kiểm chứng này xấu hơn.':'Sai số mẫu kiểm chứng không đổi.'} Cần thêm điểm/mẫu; offset không sửa mọi dạng sai số.`);}));
        button('Đặt lại dữ liệu',()=>{samples.forEach((s,i)=>s.value=String([11,21,31][i]));test.value='26.2';report('Đã phục hồi dữ liệu giả định; chưa tính lại.',false);});
    } else if (lesson.id === 'project') {
        note('Dự đoán cả trạng thái nhớ alarm và đầu ra LED. Bật khi d < 20; tắt khi d > 25; ở biên giữ trạng thái. Timeout làm LED báo lỗi nhưng không sửa biến alarm.');
        const distance=field('Mẫu tiếp theo (cm)',30,{min:0,max:500,step:0.1});
        const valid=field('Dữ liệu','valid',{choices:[{value:'valid',label:'Hợp lệ'},{value:'invalid',label:'Timeout'}]});
        const sequence=field('Chuỗi mẫu (dùng X cho timeout)','30,19,20,22,X,25,26',{multiline:true,maxLength:300});
        let alarm=false, cursor=0, history=[];
        const apply=(d,v)=>{const prior=alarm,result=hysteresisAlarm(alarm,d,v);alarm=result.alarm;showLight(result.led);history.push(`${v?`${d} cm`:'timeout'}: nhớ ${prior?'ON':'OFF'} → ${alarm?'ON':'OFF'}; ${result.state}; LED ${result.led?'sáng':'tắt'}`);report(history.slice(-12).join('\n'));};
        button('Nhận mẫu nhập',guard(()=>apply(number(distance,0,500),valid.value==='valid')));
        button('Bước chuỗi mẫu',guard(()=>{const tokens=sequence.value.split(/[\s,;]+/).filter(Boolean);if(!tokens.length||tokens.length>40)throw new Error('Nhập từ 1 đến 40 mẫu.');if(cursor>=tokens.length)throw new Error('Đã hết chuỗi; đặt lại để chạy từ OFF.');const token=tokens[cursor],v=token.toUpperCase()!=='X',d=Number(token);if(v&&(!Number.isFinite(d)||d<0||d>500))throw new Error('Mỗi mẫu là 0..500 cm hoặc X.');cursor++;apply(d,v);}));
        button('Đặt lại OFF và đầu chuỗi',()=>{alarm=false;cursor=0;history=[];showLight(false);report('Trạng thái khởi động OFF. Chưa nhận mẫu mới.',false);});
    } else note('Bài này chưa có mô hình phù hợp.');
    return {destroy(){host.replaceChildren();}};
}
