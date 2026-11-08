import {mountArduinoBench} from './benches/ArduinoBench.js';
import {mountRobotBench} from './benches/RobotBench.js';
import {mountMicrobitBench} from './benches/MicrobitBench.js';
import {mountLegoBench} from './benches/LegoBench.js';

const STYLE = `
.lesson-bench {box-sizing:border-box;color:#dbe8f7;background:#0b172a;border:1px solid #334b63;border-radius:12px;padding:1rem;line-height:1.6;min-width:0}
.lesson-bench h3 {margin:0 0 .4rem;color:#f1f5f9;font-size:1.15rem}
.lesson-bench p {margin:.6rem 0}
.lesson-bench .lesson-bench-scope {color:#a8bfd5;font-size:.9rem}
.lesson-bench .lesson-bench-note {color:#c0d5e9;font-size:.95rem}
.lesson-bench .lesson-bench-controls,.lesson-bench .lesson-bench-actions {display:flex;flex-wrap:wrap;gap:.65rem;margin:.8rem 0;align-items:end}
.lesson-bench .lesson-bench-field {display:grid;gap:.3rem;min-width:0;flex:1 1 160px;font-size:.9rem}
.lesson-bench input,.lesson-bench select,.lesson-bench textarea {box-sizing:border-box;width:100%;min-width:0;border:1px solid #64748b;border-radius:7px;padding:.55rem .65rem;background:#0c192b;color:#f1f5f9;font:inherit}
.lesson-bench textarea {resize:vertical}
.lesson-bench button {cursor:pointer;border:1px solid #5c90b6;border-radius:7px;padding:.55rem .8rem;color:#eef7ff;background:#163b58;font:inherit;line-height:1.4;white-space:normal}
.lesson-bench button:hover {background:#215475}
.lesson-bench button:focus-visible,.lesson-bench input:focus-visible,.lesson-bench select:focus-visible,.lesson-bench textarea:focus-visible {outline:3px solid #facc15;outline-offset:2px}
.lesson-bench button:disabled {opacity:.55;cursor:default}
.lesson-bench .lesson-bench-output {display:block;white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal;background:#081628;border:1px solid #47627b;border-radius:9px;padding:1rem;margin:1rem 0;font:inherit;font-size:.95rem;line-height:1.65;color:#deedf9;max-height:26rem;overflow:auto}
.lesson-bench .lesson-bench-visual {min-width:0}
.lesson-bench .lesson-bench-visual svg {max-width:100%;width:100%;max-height:130px;background:#10263c;border-radius:8px}
.lesson-bench .lesson-bench-grid {display:grid;gap:5px;max-width:480px;margin:.8rem auto}
.lesson-bench .lesson-bench-cell {display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.15rem;aspect-ratio:1;min-height:48px;min-width:0;padding:4px;border:1px solid #536a84;background:#10273c;border-radius:6px;color:#e4f1fc}
.lesson-bench .lesson-bench-cell small {font-size:.7rem;font-weight:400}
.lesson-bench .lesson-bench-cell strong {font-size:1.3rem;line-height:1.1}
.lesson-bench .lesson-bench-cell.is-wall {background:#364251;color:#d5dbe4}
.lesson-bench .lesson-bench-cell.is-goal {border:2px solid #38bdf8}
.lesson-bench .lesson-bench-cell.is-robot {background:#086b70;color:#fff}
.lesson-bench .lesson-bench-lamp,.lesson-bench .lesson-bench-display {padding:1rem;text-align:center;background:#10263c;border:1px solid #527087;border-radius:8px;margin:.7rem 0;font-size:1.25rem}
.lesson-bench .lesson-bench-lamp[data-on="true"] {color:#ffe482;background:#51410c;border-color:#facc15}
.lesson-bench table {max-width:100%;border-collapse:collapse;font-size:.9rem}
.lesson-bench th,.lesson-bench td {padding:.4rem;border:1px solid #47627b;text-align:left}
.lesson-bench table.lesson-bench-matrix th,.lesson-bench table.lesson-bench-matrix td {padding:2px;text-align:center;border:0}
.lesson-bench caption {text-align:left;color:#bcd1e6;margin-bottom:.5rem}
.lesson-bench .lesson-bench-tests {overflow-x:auto;max-width:100%}
@media(max-width:480px){.lesson-bench .lesson-bench-actions button{flex:1 1 130px}.lesson-bench .lesson-bench-cell strong{font-size:1rem}.lesson-bench .lesson-bench-cell small{font-size:.6rem}}
`;

/** Mount a fixed lesson model. Evidence describes model interaction, never code execution. */
export function mountLessonBench(host, {course, lesson, onEvidence = () => {}} = {}) {
    if (!host?.ownerDocument) throw new TypeError('Cần phần tử DOM để mở mô hình bài học.');
    const document = host.ownerDocument;
    const courseId = typeof course === 'string' ? course : course?.id;
    const root = document.createElement('section');
    root.className = 'lesson-bench';
    root.dataset.benchCourse = courseId || '';
    root.dataset.benchLesson = lesson?.id || '';
    const style = document.createElement('style');style.textContent = STYLE;
    const title = document.createElement('h3');title.textContent = `Mô hình: ${lesson?.title || 'bài học'}`;
    const scope = document.createElement('p');scope.className='lesson-bench-scope';
    scope.textContent='Mô hình quy tắc của bài: thay đầu vào để dự đoán và quan sát. Để chạy mã tự viết, chọn editor ở trên. Kết quả ở đây là kết quả mô hình.';
    const body=document.createElement('div');body.className='lesson-bench-body';
    root.append(style,title,scope,body);host.replaceChildren(root);
    let destroyed=false;
    const actions=[];
    const capture=summary=>{
        if(destroyed||typeof summary!=='string'||!summary.trim())return;
        const bounded=summary.trim().slice(0,1000);
        actions.push(bounded.slice(0,200));
        if(actions.length>40)actions.shift();
        onEvidence({kind:'local-model',lessonId:lesson.id,summary:bounded,actions:[...actions]});
    };
    const mount=courseId==='arduino'?mountArduinoBench:courseId==='microbit'?mountMicrobitBench:courseId==='lego-spike'?mountLegoBench:['vex-iq','vex-vr'].includes(courseId)?mountRobotBench:null;
    let bench;
    if(mount&&lesson?.id)bench=mount({host:body,course,lesson,onEvidence:capture});
    else {const message=document.createElement('p');message.textContent='Chưa có mô hình cho bài học này.';body.append(message);}
    return {destroy(){destroyed=true;bench?.destroy?.();root.remove();}};
}
