import assert from 'node:assert/strict';
import {ledCircuit, blinkMetrics, echoDistance, thresholdAlarm, hysteresisAlarm, calibrateOffset} from '../frontend/src/modules/learning/benches/ArduinoBench.js';
import {parseRoute, gridStep, runRoute, wheelOdometry, proportionalControl, createSearch, stepSearch, shortestPath, pathCommands, reactiveTrial, searchWithFrontier, EXPERIMENT_MAPS} from '../frontend/src/modules/learning/benches/RobotBench.js';
import {counterTransition, lightDecision, receiveRadio} from '../frontend/src/modules/learning/benches/MicrobitBench.js';
import {gearTransmission, createSorterState, advanceSorter, colorBranch, sortingRate} from '../frontend/src/modules/learning/benches/LegoBench.js';

const close=(actual,expected,tolerance=1e-9)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} differs from ${expected}`);

// Circuit continuity/polarity and declared fixed-drop assumptions.
close(ledCircuit(330).milliamps,1000*3/330);
assert.ok(ledCircuit(1000).milliamps<ledCircuit(330).milliamps);
assert.ok(ledCircuit(220).milliamps>10);
assert.equal(ledCircuit(330,false).milliamps,0);
assert.equal(ledCircuit(330,true,false).watts,0);
assert.throws(()=>ledCircuit(0));
assert.deepEqual(blinkMetrics(250,750),{period:1000,hz:1,duty:25});
assert.deepEqual(blinkMetrics(125,375),{period:500,hz:2,duty:25});
assert.throws(()=>blinkMetrics(0,0));
assert.equal(echoDistance(1000),17);
assert.equal(echoDistance(2000),34);
assert.equal(echoDistance(0),null,'Timeout must not become a 0 cm observation');
assert.equal(echoDistance(30001),null);
assert.deepEqual([19,20,21].map(d=>thresholdAlarm(d,20).state),['NEAR','FAR','FAR']);
assert.equal(thresholdAlarm(20,20,true,true).state,'NEAR');
assert.deepEqual(thresholdAlarm(0,20,false),{state:'SENSOR_ERROR',led:true});
let alarm=false;const states=[];
for(const d of [30,19,20,22,null,25,26]){const next=hysteresisAlarm(alarm,d,d!==null);alarm=next.alarm;states.push(next);}
assert.deepEqual(states.map(s=>s.alarm),[false,true,true,true,true,true,false]);
assert.deepEqual(states[4],{alarm:true,led:true,state:'SENSOR_ERROR'});
assert.equal(hysteresisAlarm(false,20).alarm,false);
assert.equal(hysteresisAlarm(false,25).alarm,false);
assert.throws(()=>hysteresisAlarm(false,10,true,25,20));
const calibration=calibrateOffset([10,20,30],[11,21,31],25,26.2);
close(calibration.offset,1);close(calibration.corrected,25.2);close(calibration.before,1.2);close(calibration.after,.2);
assert.ok(calibrateOffset([10,20,30],[15,25,35],25,25).after>0,'A bad offset can worsen holdout data');

// Robot commands track heading separately from displacement and stop at bounds.
assert.deepEqual(parseRoute('f, R ; f l F'),['F','R','F','L','F']);
assert.throws(()=>parseRoute('F,forward'));
assert.throws(()=>parseRoute('F'.repeat(121)));
const mission=runRoute(parseRoute('F,F,F,R,F,F'));
assert.equal(mission.complete,true);
assert.deepEqual([mission.state.x,mission.state.y,mission.state.heading,mission.state.forwards,mission.state.turns],[3,2,1,5,1]);
assert.deepEqual(mission.trace.map(s=>[s.x,s.y,s.heading]),[[1,0,0],[2,0,0],[3,0,0],[3,0,1],[3,1,1],[3,2,1]]);
const square=runRoute(Array(4).fill(['F','R']).flat());
assert.deepEqual([square.state.x,square.state.y,square.state.heading],[0,0,0]);
const afterLoop=runRoute(['F','F','F','F','R']);
assert.deepEqual([afterLoop.state.x,afterLoop.state.y,afterLoop.state.heading],[4,0,1]);
assert.equal(runRoute(['L','F']).complete,false);
assert.deepEqual([runRoute(['L','F']).state.x,runRoute(['L','F']).state.y],[0,0]);
assert.equal(gridStep({x:0,y:0,heading:0},'F',{walls:['1,0']}).blocked,true);
const odometry=wheelOdometry(500,56,3);
close(odometry.turns,500/(Math.PI*56));close(odometry.motorTurns,3*odometry.turns);
close(wheelOdometry(50,5.6).turns,odometry.turns);
assert.throws(()=>wheelOdometry(100,0));
assert.deepEqual(proportionalControl(0,-10,30,.5),{error:10,correction:5,left:25,right:35,saturated:false});
assert.equal(proportionalControl(179,-179,30,.5).error,-2);
const saturated=proportionalControl(0,20,30,10);
assert.deepEqual([saturated.left,saturated.right,saturated.saturated],[100,-100,true]);

// BFS is FIFO, shortest in edge count, and returns no route for a sealed column.
let search=createSearch({walls:['1,0','1,1']});
const initial=search;search=stepSearch(search);
assert.equal(initial.expanded,0,'Stepping must leave previous snapshots unchanged');
assert.deepEqual(search.queue,[{x:0,y:1}]);
const path=shortestPath({walls:['1,0','1,1']});
assert.deepEqual(path,[{x:0,y:0},{x:0,y:1},{x:0,y:2},{x:1,y:2},{x:2,y:2},{x:3,y:2}]);
assert.equal(shortestPath({walls:['1,0','1,1','1,2']}),null);
const tracedPath=runRoute(pathCommands(path));
assert.deepEqual([tracedPath.state.x,tracedPath.state.y],[3,2]);
assert.equal(reactiveTrial({walls:['1,0','1,1','1,2','1,3'],limit:40}).success,false);
assert.equal(reactiveTrial({walls:['1,0','1,1','1,2','1,3'],limit:40}).commands.length,40);

// The experiment matches the lesson's full-map BFS/DFS pair, maps and budget.
const mapSnapshot=JSON.stringify(EXPERIMENT_MAPS);
const expectedExperiment={BFS:[[7,1,20],[7,2,9],[null,null,8]],DFS:[[13,5,14],[13,5,14],[null,null,8]]};
for(const mode of ['BFS','DFS'])for(const [index,map] of EXPERIMENT_MAPS.entries()) {
    const result=searchWithFrontier({walls:map.walls,mode});
    const [steps,turns,expanded]=expectedExperiment[mode][index];
    assert.equal(result.expanded,expanded,`${mode} map ${index+1} expansion count`);
    if(steps===null) {
        assert.equal(result.path,null);assert.equal(result.reason,'no_path');
    } else {
        assert.equal(result.reason,'goal_reached');
        assert.deepEqual(result.path[0],{x:0,y:0});assert.deepEqual(result.path.at(-1),{x:4,y:3});
        assert.equal(result.path.length-1,steps);
        const commands=pathCommands(result.path);
        assert.equal(commands.filter(c=>c!=='F').length,turns);
        const execution=runRoute(commands,{walls:map.walls});
        assert.equal(execution.complete,true,'Every returned path stays within the same grid and walls');
        assert.deepEqual([execution.state.x,execution.state.y],[4,3]);
        for(const [i,point] of result.path.entries()) {
            assert.ok(!map.walls.includes(`${point.x},${point.y}`));
            if(i)assert.equal(Math.abs(point.x-result.path[i-1].x)+Math.abs(point.y-result.path[i-1].y),1);
        }
    }
    const limited=searchWithFrontier({walls:map.walls,mode,limit:1});
    assert.deepEqual(limited,{path:null,expanded:1,reason:'expansion_limit'});
}
assert.equal(JSON.stringify(EXPERIMENT_MAPS),mapSnapshot,'Both searches preserve their shared input maps');
assert.throws(()=>searchWithFrontier({mode:'reactive'}));
assert.throws(()=>searchWithFrontier({mode:'DFS',limit:0}));

// micro:bit models distinguish state replacement, accumulation and data validity.
let count=0;const counts=[];for(const event of ['A','A','B','B','A']){count=counterTransition(count,event);counts.push(count);}
assert.deepEqual(counts,[1,2,0,0,1]);
assert.equal(counterTransition(2,'A',true),1,'The intentional bug is assignment, not accumulation');
assert.equal(counterTransition(3,'A+B'),0);
assert.deepEqual([49,50,51].map(x=>lightDecision(x,50)),[true,false,false]);
let temperature=21;
for(const [group,name,value,expected] of [[7,'temp',23,23],[7,'temp',999,23],[7,'other',22,23],[7,'temp',-20,-20],[8,'temp',22,-20]]){const message=receiveRadio(temperature,{group,name,value});temperature=message.value;assert.equal(temperature,expected);}
assert.equal(receiveRadio(null,{group:7,name:'temp',value:NaN}).accepted,false);

// Gear direction/efficiency and sorter counts use separate mechanisms.
const gear=gearTransmission({teethIn:12,teethOut:36,angleIn:90,speedIn:90,torqueIn:.1,efficiency:.8});
assert.equal(gear.angleOut,-30);assert.equal(gear.speedOut,-30);close(gear.torqueOut,.24);
assert.equal(gearTransmission({teethIn:36,teethOut:12,speedIn:60}).speedOut,-180);
assert.throws(()=>gearTransmission({teethIn:0,teethOut:36}));
assert.deepEqual(['red','blue','unknown'].map(colorBranch),['A','B','CHECK']);
let sorter=createSorterState();for(const label of ['red','red','red','empty','blue','blue','empty'])sorter=advanceSorter(sorter,{type:'sample',label});
assert.deepEqual([sorter.received,sorter.successful,sorter.state],[2,2,'WAIT']);
sorter=advanceSorter(createSorterState(),{type:'sample',label:'red'},{detailed:true});
assert.deepEqual([sorter.state,sorter.phase,sorter.successful],['CLASSIFY','ACT',0]);
sorter=advanceSorter(sorter,{type:'advance'});
assert.deepEqual([sorter.phase,sorter.successful],['RETURN',0]);
sorter=advanceSorter(sorter,{type:'timeout'});
assert.deepEqual([sorter.state,sorter.received,sorter.successful],['ERROR',1,0]);
assert.equal(advanceSorter(sorter,{type:'sample',label:'empty'}).state,'ERROR');
let latched=advanceSorter(createSorterState(),{type:'sample',label:'red'});
for(const label of ['red','unknown','red'])latched=advanceSorter(latched,{type:'sample',label});
assert.equal(latched.received,1);assert.equal(latched.state,'WAIT_CLEAR');
latched=advanceSorter(latched,{type:'sample',label:'empty'});latched=advanceSorter(latched,{type:'sample',label:'red'});
assert.equal(latched.received,2);
assert.equal(sortingRate([...Array(9).fill('correct'),'wrong','unknown','jam']).percent,75);
assert.equal(sortingRate([]).percent,null);
console.log('Lesson models: circuit/timing/Echo, threshold/hysteresis/holdout calibration, route/bounds/loops, odometry/P control, FIFO BFS/no path, equal-map BFS/DFS experiment/budgets, events/radio, gears/sorter/error/rates passed.');
