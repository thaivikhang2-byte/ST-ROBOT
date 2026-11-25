# Lab integrations

## Editable micro:bit Python Editor

The micro:bit course now defaults to the Foundation's full Python Editor V3:

`https://python.microbit.org/v/3/?controller=1&flag=noWelcome&l=en`

This is an editable editor, not a shared simulator player. The official controller API is documented by [IframeHost](https://github.com/microbit-foundation/python-editor-v3/blob/v3.1.17/src/fs/host.ts) and its [protocol tests](https://github.com/microbit-foundation/python-editor-v3/blob/v3.1.17/src/fs/host-iframe.test.ts). It provides code editing, a MicroPython simulator, API reference, project files and HEX export. Hardware USB connection remains a browser/device capability requiring the user's permission.

`MicrobitEditorBridge.js` answers `workspacesync` with the current lesson's MicroPython starter or saved project, waits for `workspaceloaded`, then stores validated `workspacesave` projects. The parent checks both the exact provider origin and the current iframe window. UTF-8 files use the provider's base64 format. Each lesson uses separate, account-bound storage synchronized through the learner snapshot. The bridge accepts official unnamed projects, whose optional `projectName` may be present with value `undefined`.

The provider debounces saves for about one second and supplies no synchronous flush API. Learners wait for the saved notice before changing lessons; the download button exports the last received source. Confirmed reset removes only that lesson and recreates the iframe so an old delayed save cannot restore the discarded project. Storage failures produce a recovery message while editable source remains downloadable.

Primary samples use MicroPython; MakeCode JavaScript remains a labeled alternative for MakeCode. Radio receiver testing uses the editor's radio-chat panel; two separate editor tabs do not automatically form a radio network. Use two physical boards to verify device-to-device transmission. The simulator is separately hosted at `python-simulator.usermbit.org` ([official documentation](https://github.com/microbit-foundation/micropython-microbit-v2-simulator#embedding)).

Verification uses the actual official editor **v3.1.17**, commit `29a4fa6efee2b078a33aa6650d58ee462ac52eee`, built with its unchanged lockfile. Browser tests type into its real CodeMirror inside the ST-Robot iframe, receive authentic save messages, reload saved code, isolate lessons, download Python and confirm reset. Built provider assets are served by the test at the expected origin; simulator and other external calls are explicitly blocked. These checks prove editable integration, not live provider headers or simulator execution. Direct provider requests are blocked by this cloud environment's proxy before reaching the provider; live availability must be checked separately on the deployed website.

The real-editor test also records an upstream nonblocking rejection from the editor's service-worker cleanup when third-party service-worker access is denied. It occurs with and without the iframe sandbox; editing and saving still pass. The test reports this exact known provider error separately and fails on any unexpected browser error.

## Executable lesson programs

All displayed samples now name an executable language. Robot lessons use GearsBot ev3dev2 Python with explicit robot profiles: Single Sensor Line Follower for drive/turn/avoidance, Cage Bot for the arm/color/state lessons. Pure calculations, BFS/DFS and route-cost experiments run as Python 3 analysis. These labels identify the API target; they do not assert compatibility with VEX or SPIKE native firmware.

`tests/lesson-code-validation.py` checks 25 Python samples, 6 MakeCode JavaScript alternatives and 6 Arduino C++ sketches. Arduino controllers also run against deterministic Echo inputs through a host API contract. Robot behavior tests cover route geometry, thresholds, invalid inputs, motor timeout/stall cleanup, color-event debouncing, failed actuator cycles and experiment denominators. Official GearsBot Python modules were additionally exercised against a deterministic native-bridge model during development. Neither this model nor a host C++ build validates physical hardware or live GearsBot rendering.

## Current course choices

There are seven active tools and thirteen course/tool choices (78 lesson activities):

| Course | Offered tools | Lesson defaults |
| --- | --- | --- |
| Arduino Uno | CircuitJS, AVR8js, Wokwi, PhET, local model | CircuitJS for LED, AVR8js for timing, local model for distance/alarm/calibration/project |
| micro:bit | Python Editor, local model | Python Editor except radio, whose protocol exercise starts in the local model |
| VEX IQ / LEGO SPIKE / VEX VR | GearsBot, local model | GearsBot |

Defaults follow the actual lesson task. AVR8js is the Arduino LED configuration, not an HC-SR04 circuit editor. GearsBot uses its own supported robot API and is not native VEX/SPIKE firmware. PhET models DC circuits and does not run Arduino code. Local models are deterministic teaching models, not arbitrary code interpreters.

Scratch and MakeCode Arcade sample-player frames were removed. The unoffered MakeCode registry entry was also removed; existing curriculum language alternatives are retained. Stored Scratch/Arcade work remains valid in account records and course backups.

## Full Wokwi editor

The former shared `/share/embed/` player was replaced with an explicit launch card for the full project at `https://wokwi.com/projects/322062421191557714`. Selecting Wokwi does not open a popup automatically. The learner chooses **Mở editor Wokwi** or **Mở riêng ở tab ngoài**, makes a personal project copy, edits `sketch.ino` and `diagram.json`, and saves it in Wokwi. The link and native files can also be saved in ST-Robot. New tabs use `noopener noreferrer`.

CircuitJS, AVR8js and GearsBot retain their original iframe URLs and permissions. Python Editor uses its official controller route. PhET uses its official HTML simulation route. A transient frame failure retains the selected platform and offers reload, a new tab or the local model; it does not rewrite the catalog. An iframe load event alone is not proof of third-party execution.

## Native save/reopen workflows

See [account and lab integration](lab-account-integration.md) for the formats, privacy boundary and instructions presented to learners. GearsBot menu behavior was checked against official `QuirkyCort/gears` source commit `c0549600a26f9811906b4e02fd9246fe2413a072`: ZIP exports code, blocks and robot configuration, while world JSON must be saved separately. CircuitJS export/import menus were checked against `sharpie7/circuitjs1` commit `dd47cf43a1baa91e2d6ae0f5884ccf0f589989bf`. These source checks do not establish live service availability.

## Validation scope and generated data

`tests/ui-smoke.py` exercises the active catalog, all 78 guides, explicit Wokwi launch, original iframe permissions, retry, optional links, responsive layout and course features with local iframe/AI fixtures. `tests/platform-guides.mjs` checks 234 level variants, native save/reopen instructions, Python syntax and six compiled/executed AVR LED sketches. No paid provider requests are made.

External provider origins are blocked by the managed environment's network policy. Live embedding, provider uptime and physical hardware behavior must be checked on the deployed website; proxy denial here is not evidence of a provider outage.

`scripts/build-lab-snapshot.py` generates the inline browser catalog, backend agent catalog, guest tutor course choices and backend save/reopen workflows from editable frontend sources. `--check` detects drift. Browser regressions serve a stale standalone registry and confirm that it is never requested, so an old cached script cannot hide the current lab choices.
