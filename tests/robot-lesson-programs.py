#!/usr/bin/env python3
"""Exercise the VEX IQ/VR curriculum's executable Python lesson programs.

Run: python3 tests/robot-lesson-programs.py
No installed packages, browser, credentials or network are required.

A strict ev3dev2 API double models the documented default GearsBot singleFollower:
A/B wheels, 56 mm diameter, 152 mm track, ultrasonic input 2 and GPS input 4.
It integrates independent differential-drive kinematics and a virtual clock so
motion, route endpoints, thresholds, failures and deadlines have testable effects.
This verifies program behavior and API use, not browser physics or hardware.
"""
import contextlib
import io
import json
import math
from pathlib import Path
import sys
import types

ROOT = Path(__file__).resolve().parents[1]
courses = json.loads((ROOT / 'ai-server/curriculum.json').read_text())
programs = {(course['id'], lesson['id']): lesson['code']
            for course in courses if course['id'] in ('vex-iq', 'vex-vr')
            for lesson in course['lessons']}

class Simulation:
    def __init__(self, readings=None, stalled=False, frozen=False):
        self.now = 0.0
        self.readings = iter(readings or [255])
        self.last_reading = 255
        self.stalled = stalled
        self.frozen = frozen
        self.x = self.y = self.angle = 0.0
        self.tank = None
        self.read_count = 0
    def advance(self, dt):
        assert dt >= 0
        self.now += dt
        if self.tank is None or self.frozen:
            return
        left, right = self.tank.left_motor, self.tank.right_motor
        distances = []
        for motor in [left, right]:
            delta = motor.speed * 10.5 * dt
            if motor.target is not None:
                remaining = motor.target - motor._position
                if abs(delta) >= abs(remaining):
                    delta = remaining
                    motor.speed = 0
                    motor.target = None
            motor._position += delta
            distances.append(delta * math.pi * 56 / 360)
        left_mm, right_mm = distances
        angle_delta = (left_mm - right_mm) / 152
        self.x += (left_mm + right_mm) / 20 * math.sin(self.angle + angle_delta / 2)
        self.y += (left_mm + right_mm) / 20 * math.cos(self.angle + angle_delta / 2)
        self.angle += angle_delta
    def modules(self):
        sim = self
        class Motor:
            def __init__(self):
                self._position = self.speed = 0.0
                self.target = None
            @property
            def position(self): return int(self._position)
            @property
            def is_running(self): return self.speed != 0
            @property
            def is_stalled(self): return sim.stalled
        class MoveTank:
            def __init__(self, left, right):
                assert (left, right) == ('outA', 'outB')
                self.left_motor, self.right_motor = Motor(), Motor()
                self.off_calls = 0
                sim.tank = self
            def on_for_degrees(self, left_speed, right_speed, degrees, brake=True, block=True):
                assert block is False and brake is True
                assert degrees > 0
                assert abs(left_speed) == abs(right_speed) and 0 < abs(left_speed) <= 100
                for motor, speed in [(self.left_motor, left_speed), (self.right_motor, right_speed)]:
                    motor.speed = speed
                    motor.target = motor._position + math.copysign(degrees, speed)
            def on(self, left_speed, right_speed):
                for motor, speed in [(self.left_motor, left_speed), (self.right_motor, right_speed)]:
                    motor.speed, motor.target = speed, None
            def off(self, motors=None, brake=True):
                assert brake is True
                self.off_calls += 1
                for motor in [self.left_motor, self.right_motor]:
                    motor.speed, motor.target = 0, None
        class GPSSensor:
            def __init__(self, address): assert address == 'in4'
            @property
            def position(self):
                return (sim.x + 5 * math.sin(sim.angle), sim.y + 5 * math.cos(sim.angle), 2.5)
        class UltrasonicSensor:
            def __init__(self, address): assert address == 'in2'
            @property
            def distance_centimeters(self):
                sim.read_count += 1
                try: sim.last_reading = next(sim.readings)
                except StopIteration: pass
                return sim.last_reading
        fake_time = types.ModuleType('time')
        fake_time.time = lambda: sim.now
        fake_time.sleep = sim.advance
        package = types.ModuleType('ev3dev2')
        motor = types.ModuleType('ev3dev2.motor')
        motor.MoveTank, motor.OUTPUT_A, motor.OUTPUT_B = MoveTank, 'outA', 'outB'
        sensor = types.ModuleType('ev3dev2.sensor')
        sensor.INPUT_2, sensor.INPUT_4 = 'in2', 'in4'
        virtual = types.ModuleType('ev3dev2.sensor.virtual')
        virtual.GPSSensor = GPSSensor
        lego = types.ModuleType('ev3dev2.sensor.lego')
        lego.UltrasonicSensor = UltrasonicSensor
        return {'time': fake_time, 'ev3dev2': package, 'ev3dev2.motor': motor,
                'ev3dev2.sensor': sensor, 'ev3dev2.sensor.virtual': virtual,
                'ev3dev2.sensor.lego': lego}

def run(key, simulation=None, replace=None, error=None):
    code = programs[key]
    if replace:
        for source, target in replace.items(): code = code.replace(source, target)
    module_map = simulation.modules() if simulation else {}
    previous = {name: sys.modules.get(name) for name in module_map}
    sys.modules.update(module_map)
    output = io.StringIO()
    env = {'__name__': '__main__'}
    try:
        with contextlib.redirect_stdout(output):
            try: exec(compile(code, '/'.join(key), 'exec'), env)
            except Exception as exc:
                if error is None or not isinstance(exc, error): raise
            else:
                assert error is None, 'Expected exception was not raised'
    finally:
        for name, old in previous.items():
            if old is None: del sys.modules[name]
            else: sys.modules[name] = old
    if simulation:
        assert simulation.tank.left_motor.speed == simulation.tank.right_motor.speed == 0
        assert simulation.tank.off_calls > 0
    return env, output.getvalue()

for key, code in programs.items(): compile(code, '/'.join(key), 'exec')
print('PASS: all 12 Python programs compile')

env, output = run(('vex-iq', 'drive'), Simulation())
assert abs(env['displacement_mm'] - 200) < 1
print('PASS: 200 mm drive measures 200 mm displacement and stops')

env, output = run(('vex-iq', 'turn'), Simulation())
assert abs(env['gps'].position[0] - 25) < 0.1
assert abs(env['gps'].position[1] - 20) < 0.1
print('PASS: forward/right/forward follows differential-drive geometry')

for course, lesson in [('vex-iq', 'mission'), ('vex-vr', 'sequence'), ('vex-vr', 'loop')]:
    env, output = run((course, lesson), Simulation())
    if lesson == 'mission': assert (env['x'], env['y'], env['heading']) == (3, 2, 1)
    if lesson == 'sequence': assert (env['x'], env['y'], env['heading']) == (2, 1, 1)
    if lesson == 'loop': assert env['error_mm'] < 1
    print('PASS:', course, lesson, 'executes expected route and stops')
env, _ = run(('vex-iq', 'mission'), Simulation(), {'ROUTE_NAME = "A"': 'ROUTE_NAME = "B"'})
assert (env['x'], env['y'], env['heading']) == (3, 2, 1)
assert (env['forward_count'], env['turn_count']) == (5, 3)
print('PASS: mission alternate route reaches same state')

sim = Simulation([255, 21, 20, 19])
env, _ = run(('vex-iq', 'detect'), sim)
assert env['reason'] == 'obstacle_threshold' and sim.read_count == 4
assert abs(sim.now - 0.15) < 0.001
print('PASS: strict < threshold continues at 20 cm and stops at 19 cm')
env, _ = run(('vex-iq', 'detect'), Simulation([255]))
assert env['reason'] == 'time_limit'
print('PASS: clear path terminates at time limit')
for reading in [0, -1, 256, float('nan')]:
    run(('vex-iq', 'detect'), Simulation([reading]), error=ValueError)
print('PASS: invalid sensor data always stops motors')
run(('vex-iq', 'drive'), Simulation(stalled=True), error=RuntimeError)
frozen = Simulation(frozen=True)
run(('vex-iq', 'drive'), frozen, error=RuntimeError)
assert 8 <= frozen.now < 8.1
print('PASS: stalled and frozen motors fail with cleanup and bounded timeout')

env, output = run(('vex-vr', 'avoid'), Simulation([255]))
assert env['reason'] == 'goal_reached'
assert env['actions'] <= 12
print('PASS: avoid reaches clear-path GPS goal')
env, output = run(('vex-vr', 'avoid'), Simulation([10]))
assert env['reason'] in ['time_limit', 'action_limit']
assert 'goal_reached' not in output
print('PASS: persistent obstacle terminates without a false success')
run(('vex-vr', 'avoid'), Simulation([float('nan')]), error=ValueError)
print('PASS: avoid also stops after invalid sensor data')

for lesson in ['odometry', 'control']:
    env, output = run(('vex-iq', lesson))
    if lesson == 'odometry': assert abs(env['wheel_degrees'] - 1023.1389199) < 0.01
    if lesson == 'control':
        assert env['wheel_commands'](0, -10) == (25.0, 35.0)
        assert env['wrap_deg'](358) == -2
        assert env['wheel_commands'](0, 20) == (40.0, 20.0)
        assert max(abs(v) for v in env['wheel_commands'](0, 20, kp=10)) <= 100
print('PASS: odometry and P-control math match curriculum calculations')

env, output = run(('vex-vr', 'challenge'))
assert output.count('success: True') == 4
assert 'successful route: B' in output and 'successful route: A' in output
assert env['evaluate'](env['ROUTES']['A'], 1, 3) == (True, 5, 3, 14)
assert env['evaluate'](env['ROUTES']['B'], 1, 3) == (True, 7, 2, 13)
assert env['evaluate']('F F F F F', 1, 1)[0] is False
print('PASS: cost comparison checks endpoints and changes choice with action costs')

env, output = run(('vex-vr', 'search'))
bfs = env['bfs']
assert len(env['path']) - 1 == 5
assert len(bfs((0,0), (3,2), {(1,0),(1,1)}, 4, 3)) - 1 == 5
assert bfs((0,0), (3,2), {(1,0),(1,1),(1,2)}, 4, 3) is None
assert bfs((0,0), (3,2), {(0,0)}, 4, 3) is None
assert bfs((0,0), (0,0), set(), 1, 1) == [(0,0)]
print('PASS: BFS shortest path, blocked column, invalid start and same start/goal')

env, output = run(('vex-vr', 'experiment'))
assert output.count('no_path') == 2
assert output.count('completion: 2 / 3') == 2
for mode in ['BFS', 'DFS']:
    for blocked in env['MAPS'][:2]:
        path, expanded, reason = env['search'](blocked, mode)
        assert reason == 'goal_reached'
        assert path[0] == (0,0) and path[-1] == (4,3)
        assert all(cell not in blocked for cell in path)
        assert all(abs(a[0]-b[0])+abs(a[1]-b[1]) == 1 for a,b in zip(path,path[1:]))
_, output = run(('vex-vr', 'experiment'), replace={'EXPANSION_LIMIT = 100':'EXPANSION_LIMIT = 1'})
assert output.count('expansion_limit') == 6
assert output.count('completion: 0 / 3') == 2
print('PASS: BFS/DFS report valid paths, unreachable maps, all outcomes and limited search')
print('All robot lesson checks passed (deterministic API/kinematics; no live renderer).')
