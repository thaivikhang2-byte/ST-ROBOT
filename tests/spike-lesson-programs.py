"""Execute the published Cage Bot lesson programs against controlled API doubles.

These tests cover decisions, counts, deadlines, and issued motor commands. They do
not validate GearsBot physics, optical accuracy, collisions, or a physical SPIKE
build. The simulated API matches the official GearsBot ev3dev2 motor/sensor API;
the lesson source links identify those implementations. Real simulator testing
still needs Cage Bot, Reset, a visible colored object, and the correct ports.

Run: python tests/spike-lesson-programs.py
During content editing: python tests/spike-lesson-programs.py --proposal PATH
"""

import ast
import builtins
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]


def load_programs():
    curriculum = json.loads((ROOT / "ai-server/curriculum.json").read_text())
    lessons = next(c for c in curriculum if c["id"] == "lego-spike")["lessons"]
    programs = {lesson["id"]: lesson["code"] for lesson in lessons}
    if "--proposal" in sys.argv:
        index = sys.argv.index("--proposal")
        proposals = json.loads(Path(sys.argv[index + 1]).read_text())
        for proposal in proposals:
            if proposal["courseId"] == "lego-spike":
                programs[proposal["lessonId"]] = proposal["updates"]["code"]
        del sys.argv[index:index + 2]
    return programs


PROGRAMS = load_programs()


class Harness:
    def __init__(self, frame=None, stalled_command=None, bad_profile=False,
                 project_colors=None, absent_trials=(), never_clear_trials=()):
        self.now = 0.0
        self.frame = frame or (lambda now: (255.0, 0))
        self.stalled_command = stalled_command
        self.bad_profile = bad_profile
        self.commands = []
        self.stops = 0
        self.output = []
        self.namespace = {}
        self.arm = None
        self.project_colors = project_colors
        self.absent_trials = set(absent_trials)
        self.never_clear_trials = set(never_clear_trials)
        self.trial = 0
        self.approach_at = None

    def sleep(self, seconds):
        if seconds < 0:
            raise AssertionError("A program requested a negative sleep")
        self.now += seconds
        if self.now > 400:
            raise AssertionError("Program exceeded its finite test budget")

    def capture(self, *values, **kwargs):
        self.output.append(tuple(values))
        if self.project_colors is None or not values:
            return
        if values[0] == "Trial":
            self.trial = values[1]
            self.approach_at = None
        elif values[0] == "APPROACH: 20 seconds":
            self.approach_at = self.now + 0.2
        elif values[0] == "RESULT":
            self.approach_at = None

    def sensor_frame(self):
        # The real wrapper yields briefly on each sensor access as well.
        self.sleep(0.001)
        if self.project_colors is None:
            return self.frame(self.now)
        if self.trial in self.never_clear_trials:
            return 2.0, 5
        if (self.approach_at is None or self.now < self.approach_at
                or self.trial in self.absent_trials):
            return 255.0, 0
        return 2.0, self.project_colors[self.trial - 1]

    def run(self, lesson_id):
        harness = self

        class SpeedDPS:
            def __init__(self, degrees_per_second):
                self.degrees_per_second = degrees_per_second

        class LargeMotor:
            def __init__(self, port):
                if port != "outC":
                    raise AssertionError("Cage Bot's arm is on outC")
                harness.arm = self
                self.angle = 0.0
                self.target = 0.0
                self.last_time = harness.now
                self.running = False
                self.stalled = False
                self.speed = 0.0

            def update(self):
                elapsed = harness.now - self.last_time
                self.last_time = harness.now
                if self.running and not self.stalled:
                    difference = self.target - self.angle
                    step = min(abs(difference), self.speed * elapsed)
                    self.angle += step if difference >= 0 else -step

            @property
            def position(self):
                self.update()
                return round(self.angle)

            def on_to_position(self, speed, position, brake=True, block=True):
                self.update()
                if block or not brake or not isinstance(speed, SpeedDPS):
                    raise AssertionError("Use explicit, braked, nonblocking arm control")
                if not 0 <= position <= 45:
                    raise AssertionError("Command left the declared 0..45 degree test range")
                self.target = position
                self.speed = abs(speed.degrees_per_second)
                self.running = True
                harness.commands.append((harness.now, position, self.speed))
                self.stalled = len(harness.commands) == harness.stalled_command

            def off(self, brake=True):
                self.update()
                if not brake:
                    raise AssertionError("The lesson must brake on stop")
                self.running = False
                harness.stops += 1

        class ColorSensor:
            def __init__(self, port):
                if harness.bad_profile:
                    raise TypeError("No color sensor connected to in3")
                if port != "in3":
                    raise AssertionError("Use Cage Bot's forward color sensor, in3")

            @property
            def color(self):
                return harness.sensor_frame()[1]

        class UltrasonicSensor:
            def __init__(self, port):
                if port != "in4":
                    raise AssertionError("Cage Bot's ultrasonic sensor is on in4")

            @property
            def distance_centimeters(self):
                return harness.sensor_frame()[0]

        ev3dev2 = types.ModuleType("ev3dev2")
        motor = types.ModuleType("ev3dev2.motor")
        motor.LargeMotor, motor.OUTPUT_C, motor.SpeedDPS = LargeMotor, "outC", SpeedDPS
        sensor = types.ModuleType("ev3dev2.sensor")
        lego = types.ModuleType("ev3dev2.sensor.lego")
        lego.ColorSensor, lego.UltrasonicSensor = ColorSensor, UltrasonicSensor
        clock = types.ModuleType("time")
        clock.time, clock.sleep = lambda: self.now, self.sleep
        modules = {"ev3dev2": ev3dev2, "ev3dev2.motor": motor,
                   "ev3dev2.sensor": sensor, "ev3dev2.sensor.lego": lego, "time": clock}
        self.namespace = {"__builtins__": dict(vars(builtins), print=self.capture)}
        with patch.dict(sys.modules, modules):
            exec(compile(PROGRAMS[lesson_id], lesson_id, "exec"), self.namespace)
        return self

    def targets(self):
        return [command[1] for command in self.commands]


def object_sequence(now):
    # Repeated readings and label loss belong to the same first object.
    # The 8..8.05 clear blip is shorter than the required three samples.
    if 2 <= now < 14:
        if 8 <= now < 8.05:
            return 255.0, 0
        return 2.0, 0 if 9 <= now < 10 else 5
    if 20 <= now < 35:
        return 2.0, 2
    if 45 <= now < 60:
        return 2.0, 4
    return 255.0, 5  # Red alone must not imply that an object is present.


class SpikeLessonTests(unittest.TestCase):
    def test_all_six_programs_parse(self):
        self.assertEqual(set(PROGRAMS), {"mechanism", "colors", "sort", "project", "ratio", "state"})
        for lesson_id, source in PROGRAMS.items():
            with self.subTest(lesson=lesson_id):
                ast.parse(source)

    def test_mechanism_moves_and_separates_gear_prediction(self):
        result = Harness().run("mechanism")
        self.assertEqual(result.targets(), [0, 30, 0])
        self.assertAlmostEqual(result.arm.position, 0, delta=2)
        self.assertEqual(result.namespace["output_deg"], -30)
        self.assertEqual(result.namespace["required_motor_deg"], -60)
        self.assertFalse(result.arm.running)

    def test_gear_ratio_outputs(self):
        result = Harness().run("ratio")
        self.assertEqual(result.namespace["speed_out_rpm"], -30)
        self.assertAlmostEqual(result.namespace["torque_out_nm"], 0.24)

    def test_color_program_reads_real_sensor_contract(self):
        result = Harness(object_sequence).run("colors")
        labels = {row[3] for row in result.output if row and row[0] == "color_id"}
        self.assertEqual(labels, {"A", "B", "CHECK"})
        self.assertEqual(result.targets(), [45])
        self.assertLess(result.now, 60.2)

    def test_repeated_objects_and_short_clear_blip_do_not_retrigger(self):
        for lesson in ("sort", "state"):
            with self.subTest(lesson=lesson):
                result = Harness(object_sequence).run(lesson)
                self.assertEqual(result.namespace["received"], 3)
                self.assertEqual(result.namespace["gate_cycles"], 2)
                self.assertEqual(result.namespace["needs_check"], 1)
                self.assertEqual(result.targets(), [45, 0, 45, 0, 45])
                self.assertFalse(result.arm.running)
                self.assertLess(result.now, 90.2)

    def test_unknown_is_latched_until_distance_confirms_clear(self):
        def frame(now):
            if 2 <= now < 15:
                return 2.0, 0 if now < 6 else 5
            if 15 <= now < 20:
                return 5.0, 0  # Hysteresis band is not confirmed clear.
            if 20 <= now < 25:
                return 2.0, 5
            return 255.0, 0
        for lesson in ("sort", "state"):
            with self.subTest(lesson=lesson):
                result = Harness(frame).run(lesson)
                self.assertEqual(result.namespace["received"], 1)
                self.assertEqual(result.namespace["needs_check"], 1)
                self.assertEqual(result.namespace["gate_cycles"], 0)
                self.assertEqual(result.targets(), [45])

    def test_no_hit_is_clear_and_far_colors_do_not_trigger(self):
        for lesson in ("sort", "state"):
            with self.subTest(lesson=lesson):
                result = Harness(lambda now: (255.0, 5)).run(lesson)
                self.assertEqual(result.namespace["received"], 0)
                self.assertEqual(result.targets(), [45])

    def test_boundary_presence_and_clear_rearm(self):
        def frame(now):
            if 2 <= now < 12 or 20 <= now < 32:
                return 3.0, 5
            return 8.0, 0
        for lesson in ("sort", "state"):
            with self.subTest(lesson=lesson):
                result = Harness(frame).run(lesson)
                self.assertEqual(result.namespace["received"], 2)
                self.assertEqual(result.namespace["gate_cycles"], 2)
                self.assertEqual(result.targets(), [45, 0, 45, 0, 45])

    def test_close_or_reopen_timeout_never_counts_success(self):
        for lesson in ("sort", "state"):
            for stalled_command in (2, 3):
                with self.subTest(lesson=lesson, command=stalled_command):
                    result = Harness(object_sequence, stalled_command=stalled_command).run(lesson)
                    self.assertEqual(result.namespace["received"], 1)
                    self.assertEqual(result.namespace["gate_cycles"], 0)
                    self.assertEqual(len(result.commands), stalled_command)
                    self.assertFalse(result.arm.running)
                    self.assertTrue(any("ERROR" in str(row) for row in result.output))
                    if lesson == "state":
                        self.assertEqual(result.namespace["state"], "ERROR")

    def test_invalid_distance_stops_the_controller(self):
        for lesson in ("sort", "state"):
            with self.subTest(lesson=lesson):
                result = Harness(lambda now: (0.0, 5)).run(lesson)
                self.assertEqual(result.namespace["gate_cycles"], 0)
                self.assertFalse(result.arm.running)
                self.assertTrue(any("ERROR" in str(row) for row in result.output))

    def test_wrong_profile_fails_before_any_motor_command(self):
        for lesson in ("mechanism", "colors", "sort", "project", "state"):
            with self.subTest(lesson=lesson):
                result = Harness(bad_profile=True)
                with self.assertRaisesRegex(RuntimeError, "Cage Bot"):
                    result.run(lesson)
                self.assertEqual(result.commands, [])

    def test_project_reports_all_ten_trials(self):
        colors = [5, 2, 4, 5, 2, 5, 4, 2, 5, 2]
        result = Harness(project_colors=colors).run("project")
        self.assertEqual(result.namespace["attempted"], 10)
        self.assertEqual(result.namespace["passed"], 10)
        self.assertEqual(result.namespace["recognized"], 10)
        self.assertEqual(result.targets(), [45] + [0, 45] * 8)
        self.assertIn(("complete_test", True), result.output)

    def test_project_timeout_remains_in_denominator(self):
        colors = [5, 2, 4, 5, 2, 5, 4, 2, 5, 2]
        for kwargs in ({"absent_trials": {1}}, {"never_clear_trials": {1}}):
            with self.subTest(case=kwargs):
                result = Harness(project_colors=colors, **kwargs).run("project")
                self.assertEqual(result.namespace["attempted"], 10)
                self.assertEqual(result.namespace["passed"], 9)
                self.assertEqual(len(result.namespace["results"]), 10)
                self.assertIn(("classification_and_gate_percent", 90.0), result.output)

    def test_project_motor_fault_reports_abort_and_failed_attempt(self):
        colors = [5, 2, 4, 5, 2, 5, 4, 2, 5, 2]
        result = Harness(project_colors=colors, stalled_command=2).run("project")
        self.assertEqual(result.namespace["attempted"], 1)
        self.assertEqual(result.namespace["passed"], 0)
        self.assertEqual(result.namespace["results"][0][3], "GATE_TIMEOUT")
        self.assertIn(("planned", 10, "attempted", 1), result.output)
        self.assertIn(("complete_test", False), result.output)
        self.assertIn(("classification_and_gate_percent", 0.0), result.output)
        self.assertFalse(result.arm.running)

    def test_fsm_global_deadline_reports_unfinished_cycle(self):
        result = Harness(lambda now: (2.0, 5) if now >= 89 else (255.0, 0)).run("state")
        self.assertEqual(result.namespace["received"], 1)
        self.assertEqual(result.namespace["gate_cycles"], 0)
        self.assertEqual(result.namespace["state"], "ERROR")
        self.assertFalse(result.arm.running)


if __name__ == "__main__":
    unittest.main(verbosity=2)
