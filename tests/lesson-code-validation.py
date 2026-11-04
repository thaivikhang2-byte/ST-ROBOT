#!/usr/bin/env python3
"""Validate the actual lesson programs, without pretending to compile device firmware.

Python is parsed, MakeCode JavaScript is syntax checked, and Arduino programs are
compiled against a small declared API contract. Two Arduino controllers also run
against deterministic Echo inputs to check thresholds, timeout and state memory.
Robot motion/sensor behavior is checked separately by robot/spike-lesson-programs.py.
"""
import ast
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
courses = json.loads((ROOT / 'ai-server/curriculum.json').read_text())
assert shutil.which('node') and shutil.which('g++'), 'Node.js and g++ are required'
header = r'''
#include <cassert>
#include <cstddef>
#include <vector>
using byte = unsigned char;
const int LED_BUILTIN=13, OUTPUT=1, INPUT=0, HIGH=1, LOW=0;
std::vector<unsigned long> echoes;
std::size_t echo_index=0;
std::vector<int> led_states;
void pinMode(int, int) {}
void digitalWrite(int pin, int value) { if(pin==LED_BUILTIN) led_states.push_back(value); }
void delay(unsigned long) {}
void delayMicroseconds(unsigned int) {}
unsigned long pulseIn(int,int,unsigned long) { return echoes.at(echo_index++); }
struct SerialPort {
 void begin(unsigned long) {}
 template<typename T> void print(T) {}
 template<typename T> void println(T) {}
} Serial;
'''
counts = {'Python': 0, 'MakeCode JavaScript': 0, 'Arduino C++': 0}
with tempfile.TemporaryDirectory(prefix='strobot-lesson-code-') as directory:
    tmp = Path(directory)
    arduino = {}
    for course in courses:
        for lesson in course['lessons']:
            examples = [{'id': 'primary', 'lang': lesson['lang'], 'code': lesson['code']}, *lesson.get('codeVariants', [])]
            for example in examples:
                key = f"{course['id']}-{lesson['id']}-{example['id']}"
                language, source = example['lang'], example['code']
                assert 'Giả mã' not in language, f'{key}: sample must name an executable language'
                if 'Python' in language:
                    ast.parse(source, filename=key)
                    counts['Python'] += 1
                elif 'JavaScript' in language:
                    path = tmp / (key + '.mjs')
                    path.write_text(source)
                    subprocess.run(['node', '--check', str(path)], check=True, capture_output=True)
                    counts['MakeCode JavaScript'] += 1
                elif 'Arduino' in language:
                    path = tmp / (key + '.cpp')
                    path.write_text(header + '\n' + source)
                    subprocess.run(['g++', '-std=c++11', '-fsyntax-only', str(path)], check=True, capture_output=True)
                    arduino[lesson['id']] = source
                    counts['Arduino C++'] += 1
                else:
                    raise AssertionError(f'{key}: unverified sample language {language}')
    # Values straddle the strict 20/25 cm thresholds; zero represents Echo timeout.
    for lesson_id, expected in [('alarm', [0, 1, 0, 0, 1, 0]), ('project', [0, 1, 1, 0, 1, 0])]:
        main = '\nint main(){ echoes={1200,1100,1400,1500,0,1300}; setup(); for(int i=0;i<6;++i)loop(); assert(led_states==std::vector<int>({' + ','.join(map(str, expected)) + '})); }\n'
        path = tmp / (lesson_id + '-behavior.cpp')
        binary = tmp / lesson_id
        path.write_text(header + '\n' + arduino[lesson_id] + main)
        subprocess.run(['g++', '-std=c++11', str(path), '-o', str(binary)], check=True, capture_output=True)
        subprocess.run([str(binary)], check=True, timeout=5)

print('PASS sample syntax:', ', '.join(f'{count} {language}' for language, count in counts.items()))
print('PASS Arduino threshold, timeout indication and hysteresis memory (host API contract; not device firmware)')
