import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {getPlatformGuide} from '../frontend/src/modules/learning/PlatformGuides.js';

const curriculum = JSON.parse(fs.readFileSync(new URL('../ai-server/curriculum.json', import.meta.url)));
const registry = {window: {}};
vm.runInNewContext(fs.readFileSync(new URL('../frontend/src/data/lab-platforms.js', import.meta.url), 'utf8'), registry);
const guides = [];
let variants = 0;
for (const course of curriculum) {
    for (const lesson of course.lessons) {
        for (const platformKey of registry.window.STROBOT_COURSE_LABS[course.id]) {
            const levels = ['beginner', 'intermediate', 'advanced'].map(level => getPlatformGuide({course, lesson, platformKey, level}));
            variants += levels.length;
            const guide = levels[0];
            guides.push(guide);
            assert.equal(guide.id, `${course.id}:${lesson.id}:${platformKey}`);
            assert.ok(['primary', 'related'].includes(guide.activityType));
            for (const field of ['title', 'goal', 'capability', 'levelChallenge']) assert.ok(typeof guide[field] === 'string' && guide[field].length > 15, `${guide.id}: ${field}`);
            for (const field of ['setupSteps', 'steps', 'expected', 'troubleshooting', 'evidence']) {
                assert.ok(Array.isArray(guide[field]) && guide[field].length > 0, `${guide.id}: ${field}`);
                assert.ok(guide[field].every(value => typeof value === 'string' && value.trim().length > 3), `${guide.id}: empty ${field}`);
            }
            assert.ok(guide.steps.length >= 3, `${guide.id}: explicit sequence`);
            assert.ok(guide.comparison.mission && guide.comparison.limit && guide.comparison.measurements.length, `${guide.id}: comparison must name evidence and limits`);
            assert.deepEqual(levels.map(value => value.level), ['beginner', 'intermediate', 'advanced']);
            assert.equal(new Set(levels.map(value => value.levelChallenge)).size, 3);
            assert.deepEqual(levels[0].codeExamples, levels[2].codeExamples, 'Scaffolding must not silently change runtime/language');
            assert.deepEqual(guide, getPlatformGuide({course: course.id, lesson, platformKey}));
            if (['local', 'circuit', 'phet', 'scratch'].includes(platformKey)) assert.deepEqual(guide.codeExamples, [], `${guide.id}: no executable text code for this activity`);
            else {
                assert.ok(guide.codeExamples.length > 0, `${guide.id}: runnable native sample`);
                for (const sample of guide.codeExamples) {
                    for (const field of ['id', 'label', 'lang', 'code', 'extension']) assert.ok(sample[field], `${guide.id}: code ${field}`);
                    const extension = ['wokwi', 'avr'].includes(platformKey) ? 'ino' : platformKey === 'arcade' ? 'ts' : 'py';
                    assert.equal(sample.extension, extension, `${guide.id}: platform language`);
                    if (['wokwi', 'avr'].includes(platformKey)) assert.match(sample.code, /void setup\(/);
                    if (platformKey === 'python') assert.match(sample.code, /from microbit import/);
                    if (platformKey === 'arcade') assert.doesNotMatch(sample.code, /from microbit|ev3dev2|void setup/);
                }
            }
        }
    }
}
assert.equal(guides.length, 126);
assert.equal(variants, 378);
for (const course of curriculum) {
    for (const platformKey of registry.window.STROBOT_COURSE_LABS[course.id]) {
        const activities = guides.filter(guide => guide.courseId === course.id && guide.platformKey === platformKey);
        assert.equal(new Set(activities.map(guide => guide.steps.join('\n'))).size, 6, `${course.id}/${platformKey}: per-lesson activities`);
    }
}
assert.throws(() => getPlatformGuide({course: 'microbit', lesson: curriculum[2].lessons[0], platformKey: 'wokwi'}), RangeError);
assert.throws(() => getPlatformGuide({course: 'arduino', lesson: {id: 'matrix'}, platformKey: 'local'}), RangeError);
assert.throws(() => getPlatformGuide({course: curriculum[0], lesson: curriculum[0].lessons[0], platformKey: 'local', level: 'expert'}), RangeError);

// Capabilities refer to the actual configured player, not to a whole provider's product range.
for (const guide of guides.filter(value => value.platformKey === 'avr')) {
    assert.match(guide.capability, /không cung cấp HC-SR04/);
    assert.doesNotMatch(guide.codeExamples[0].code, /pulseIn|UltrasonicSensor|microbit/);
    assert.equal(guide.activityType, guide.lessonId === 'timing' ? 'primary' : 'related');
}
for (const guide of guides.filter(value => ['scratch', 'arcade'].includes(value.platformKey))) {
    assert.equal(guide.activityType, 'related');
    assert.match(guide.setupSteps.join(' '), /tab riêng/);
    assert.match(guide.capability, /chỉ chạy/);
}
for (const guide of guides.filter(value => value.platformKey === 'wokwi')) {
    assert.match(guide.setupSteps.join(' '), /sketch\.ino/);
    if (['distance', 'alarm', 'project'].includes(guide.lessonId)) assert.match(guide.setupSteps.join(' '), /TRIG→D9, ECHO→D10/);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-guides-'));
try {
    // Syntax-check all Python examples as Python, without importing device modules.
    const python = guides.flatMap(guide => guide.codeExamples.filter(sample => sample.extension === 'py').map(sample => ({id: `${guide.id}/${sample.id}`, code: sample.code})));
    const pythonFile = path.join(temporary, 'python-examples.json');
    fs.writeFileSync(pythonFile, JSON.stringify(python));
    const result = spawnSync('python3', ['-c', 'import ast,json,sys\nfor item in json.load(open(sys.argv[1])): ast.parse(item["code"], filename=item["id"])', pythonFile], {encoding: 'utf8', timeout: 10000});
    assert.equal(result.status, 0, result.stderr);

    // Compile AND execute the six LED-only sketches against a declared host API.
    // This catches an API/language mismatch and checks their observable LED traces.
    for (const guide of guides.filter(value => value.platformKey === 'avr')) {
        const source = path.join(temporary, `${guide.lessonId}.cpp`);
        const binary = path.join(temporary, guide.lessonId);
        fs.writeFileSync(source, `#include <iostream>\nusing byte = unsigned char;\nconst int LED_BUILTIN=13,OUTPUT=1,HIGH=1,LOW=0;\nunsigned long elapsed=0;\nvoid pinMode(int,int){}\nvoid digitalWrite(int,int value){std::cout<<elapsed<<":"<<value<<"\\n";}\nvoid delay(unsigned long ms){elapsed+=ms;}\n${guide.codeExamples[0].code}\nint main(){setup();loop();}\n`);
        const compilation = spawnSync('g++', ['-std=c++11', source, '-o', binary], {encoding: 'utf8'});
        assert.equal(compilation.status, 0, `${guide.id}: ${compilation.stderr}`);
        const run = spawnSync(binary, [], {encoding: 'utf8'});
        assert.equal(run.status, 0, `${guide.id}: sketch terminates a declared test cycle`);
        const trace = run.stdout.trim().split('\n').map(line => line.split(':').map(Number));
        if (guide.lessonId === 'led') assert.deepEqual(trace, [[0, 1], [500, 0]]);
        if (guide.lessonId === 'timing') assert.deepEqual(trace, [[0, 1], [200, 0]]);
        if (guide.lessonId === 'distance') {
            assert.equal(trace.filter(([, state]) => state === 1).length, 6, 'one long + two long + three short pulses');
            const durations = trace.filter(([, state]) => state === 1).map(([at], i) => trace.filter(([, state]) => state === 0)[i][0] - at);
            assert.deepEqual(durations, [500, 500, 500, 100, 100, 100]);
        }
        if (guide.lessonId === 'alarm') assert.deepEqual(trace.filter(([at]) => [1000, 5000, 9000].includes(at)).map(([, state]) => state), [1, 0, 0]);
        if (guide.lessonId === 'calibration') assert.deepEqual(trace, [[0, 0], [1000, 1], [4000, 0], [5000, 0]]);
        if (guide.lessonId === 'project') assert.deepEqual(trace.filter(([at]) => [0, 3000, 6000, 9000, 15000, 18000].includes(at)).map(([, state]) => state), [0, 1, 1, 1, 1, 0]);
    }

    // Exercise pure Arcade sample control flow with a small explicit provider API model.
    // It checks recipes and termination, not the MakeCode compiler or live simulator.
    for (const guide of guides.filter(value => value.platformKey === 'arcade')) {
        const messages = [], handlers = [];
        const image = {create() {return {fill() {}, fillRect() {}, setPixel() {}};}};
        const controller = Object.fromEntries(['A', 'B', 'left', 'right', 'up', 'down'].map(key => [key, {onEvent(event, handler) {handlers.push(handler);}}]));
        const context = {image, sprites: {create(value) {return {image: value, setPosition() {}, setFlag() {}};}}, SpriteKind: {Player: 0}, controller, ControllerButtonEvent: {Pressed: 0}, info: {setScore() {}}, game: {splash(...args) {messages.push(args.join(' '));}}, pause() {}, console: {log() {}}, Math: Object.assign(Object.create(Math), {idiv(a, b) {return Math.trunc(a / b);}})};
        // The examples only use number annotations, including nested number arrays.
        const script = guide.codeExamples[0].code.replace(/:\s*number(?:\[\])*/g, '');
        vm.runInNewContext(script, context, {timeout: 1000, filename: guide.id});
        for (const handler of handlers) handler();
        if (guide.lessonId === 'experiment') assert.equal(messages.filter(message => message.includes('2/3')).length, 2);
        if (guide.lessonId === 'search') assert.ok(messages.some(message => message.includes('distance 5')), 'BFS uses the declared grid');
    }
} finally {
    fs.rmSync(temporary, {recursive: true, force: true});
}

console.log(`Platform guides: ${guides.length} lesson/platform activities, ${variants} level variants; Python syntax, six native LED sketches and 24 Arcade recipes passed.`);
