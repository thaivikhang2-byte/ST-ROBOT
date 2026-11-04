# Lab integrations

## Editable micro:bit Python Editor

The micro:bit course now defaults to the Foundation's full Python Editor V3:

`https://python.microbit.org/v/3/?controller=1&flag=noWelcome&l=en`

This is an editable editor, not a shared simulator player. The official controller API is documented by [IframeHost](https://github.com/microbit-foundation/python-editor-v3/blob/v3.1.17/src/fs/host.ts) and its [protocol tests](https://github.com/microbit-foundation/python-editor-v3/blob/v3.1.17/src/fs/host-iframe.test.ts). It provides code editing, a MicroPython simulator, API reference, project files and HEX export. Hardware USB connection remains a browser/device capability requiring the user's permission.

`MicrobitEditorBridge.js` answers `workspacesync` with the current lesson's MicroPython starter or saved project, waits for `workspaceloaded`, then stores validated `workspacesave` projects. The parent checks both the exact provider origin and the current iframe window. UTF-8 files use the provider's base64 format. Each lesson has separate browser storage. The bridge accepts official unnamed projects, whose optional `projectName` may be present with value `undefined`.

The provider debounces saves for about one second and supplies no synchronous flush API. Learners wait for the saved notice before changing lessons; the download button exports the last received source. Confirmed reset removes only that lesson and recreates the iframe so an old delayed save cannot restore the discarded project. Storage failures produce a recovery message while editable source remains downloadable.

Primary samples use MicroPython; MakeCode JavaScript remains a labeled alternative for MakeCode. Radio receiver testing uses the editor's radio-chat panel; two separate editor tabs do not automatically form a radio network. Use two physical boards to verify device-to-device transmission. The simulator is separately hosted at `python-simulator.usermbit.org` ([official documentation](https://github.com/microbit-foundation/micropython-microbit-v2-simulator#embedding)).

Verification uses the actual official editor **v3.1.17**, commit `29a4fa6efee2b078a33aa6650d58ee462ac52eee`, built with its unchanged lockfile. Browser tests type into its real CodeMirror inside the ST-Robot iframe, receive authentic save messages, reload saved code, isolate lessons, download Python and confirm reset. Built provider assets are served by the test at the expected origin; simulator and other external calls are explicitly blocked. These checks prove editable integration, not live provider headers or simulator execution. Direct provider requests are blocked by this cloud environment's proxy before reaching the provider; live availability must be checked separately on the deployed website.

The real-editor test also records an upstream nonblocking rejection from the editor's service-worker cleanup when third-party service-worker access is denied. It occurs with and without the iframe sandbox; editing and saving still pass. The test reports this exact known provider error separately and fails on any unexpected browser error.

## Executable lesson programs

All displayed samples now name an executable language. Robot lessons use GearsBot ev3dev2 Python with explicit robot profiles: Single Sensor Line Follower for drive/turn/avoidance, Cage Bot for the arm/color/state lessons. Pure calculations, BFS/DFS and route-cost experiments run as Python 3 analysis. These labels identify the API target; they do not assert compatibility with VEX or SPIKE native firmware.

`tests/lesson-code-validation.py` checks 25 Python samples, 6 MakeCode JavaScript alternatives and 6 Arduino C++ sketches. Arduino controllers also run against deterministic Echo inputs through a host API contract. Robot behavior tests cover route geometry, thresholds, invalid inputs, motor timeout/stall cleanup, color-event debouncing, failed actuator cycles and experiment denominators. Official GearsBot Python modules were additionally exercised against a deterministic native-bridge model during development. Neither this model nor a host C++ build validates physical hardware or live GearsBot rendering.

## Restored original platforms

CircuitJS, AVR8js and GearsBot URLs and iframe permissions are preserved from commit `4b26e4a`. The requested micro:bit replacement is described above; the old MakeCode registry entry remains for compatibility but is no longer a course-menu choice.

| Platform | Original URL | Default courses |
| --- | --- | --- |
| CircuitJS | https://www.falstad.com/circuit/circuitjs.html | Additional original Arduino option |
| AVR8js | https://www.falstad.com/circuit/avr8js/ | Arduino Uno |
| MakeCode micro:bit | https://makecode.microbit.org/#editor | Legacy entry; JavaScript variants use MakeCode |
| GearsBot | https://gears.aposteriori.com.sg/ | VEX IQ, LEGO SPIKE Prime, VEXcode VR |

The original in-page numerical/logic bench remains available as the last choice. This is a simple model, not a substitute for a complete hardware simulator.

## Additional official iframe endpoints

Only embed routes are configured. There is no external-only platform choice or automatic popup fallback. Each selected lab has an optional new-tab link. Arduino and robot defaults are preserved; micro:bit defaults to the editable Python Editor. No platform-help link is rendered.

| Addition | Configured iframe URL | Official source evidence |
| --- | --- | --- |
| Wokwi Uno | https://wokwi.com/share/embed/322062421191557714 | The Uno project ID appears in [official welcome docs](https://github.com/wokwi/wokwi-docs/blob/main/docs/welcome.md). The numeric `/share/embed/` route is documented in [official issue 526](https://github.com/wokwi/wokwi-features/issues/526). |
| PhET DC circuits | https://phet.colorado.edu/sims/html/circuit-construction-kit-dc/latest/circuit-construction-kit-dc_all.html | [Official iframe template](https://github.com/phetsims/chipper/blob/main/templates/sim-iframe.html) and [simulation source](https://github.com/phetsims/circuit-construction-kit-dc). |
| Scratch Maze Starter | https://scratch.mit.edu/projects/10128431/embed | Project ID from [Scratch starter-project data](https://github.com/scratchfoundation/scratch-www/blob/develop/src/views/starter-projects/starter-projects.json), route supported by the [official embedded player](https://github.com/scratchfoundation/scratch-www/blob/develop/src/views/preview/embed-view.jsx). |
| MakeCode Arcade | https://arcade.makecode.com/---run?id=_1yfTMtFAe5yC | Project ID from [Microsoft game gallery](https://github.com/microsoft/pxt-arcade/blob/master/docs/games.md); simulator embed supported by [PXT sharing](https://github.com/microsoft/pxt/blob/master/common-docs/share.md) and its URL generator. |

Scratch and Arcade frames run examples; they are not full VEX/LEGO hardware editors. PhET models DC circuits, not Arduino code. GearsBot remains an alternative robot environment rather than an exact VEX/LEGO emulator. These distinctions are retained in the lesson material.

New frames cannot automatically open popup tabs or navigate the top page. The user can explicitly choose the parent page’s “Mở riêng ở tab ngoài” link with `target="_blank"` and `rel="noopener noreferrer"`. Wokwi/Scratch/Arcade links open their full editor pages; the local bench reopens the current course and lesson with `view=lab&lab=local`. A new platform that raises a frame load error is removed for the current session and the original course lab is restored. Original platforms retain their pre-change iframe behavior and are not removed by this extra handling. An iframe load event alone is not proof of successful third-party execution.

## Validation scope

Official source documentation supports the added routes. Direct provider requests from this managed environment failed at the network proxy CONNECT stage with HTTP 403; that is not evidence that the provider rejects website embedding. It must not be used to remove the user's original working labs.

The browser suite uses local iframe fixtures to verify all original URLs/defaults, the four added embed URLs, local benches, blocked-addition recovery, optional new-tab links and preservation of the embedded view, responsive layout and existing course features. It does not claim live provider availability. Editors without a supported iframe mode remain excluded. Python Editor is included through its explicit controller API.

## Atomic browser snapshot

A stale copy of the old standalone registry was reproduced against the restored page: it displayed only the local bench, matching the reported screenshot. The lab registry is now bundled into `course.learning.html` by `scripts/build-lab-snapshot.py`, so the page and lab data share one HTTP response. The editable JS source remains in `frontend/src/data/lab-platforms.js`. `--check` detects an out-of-date page snapshot; the browser regression feeds an old registry response and asserts it is never requested.
