# ST-Robot: platform research

Research date: 2026-11-01. This report reads official GitHub source/documentation only. Provider HTTP hosts are outside the running environment allowlist; no provider hosts were called, proxy bypassed, or network configuration changed. Thus **source-documented integration is not a claim of a successful live iframe/browser session**. Retain an explicit separate-open link for every remote lab. Do not infer a successful third-party simulation from iframe onload.

## Recommended additions

| Platform | iframe/entry URL | Separate editor | Course fit | Evidence and limits |
| --- | --- | --- | --- | --- |
| Wokwi Arduino Uno | `https://wokwi.com/share/embed/322062421191557714` | `https://wokwi.com/projects/322062421191557714` | Arduino Uno; C++ sketch/LED, board I/O; practical companion to all six Arduino lessons | Numeric project ID is the official docs Uno Hello World example. `/share/embed/<numeric-id>` is documented by an issue on the official feature tracker, acknowledged by owner urish; exact numeric example in that issue was `282702715864220173`. No `?embed=1` query confirmation was found in official docs, so prefer source-backed `/share/embed/`. Saving copies may require provider account; not all physical sensor effects are modeled. |
| PhET Circuit Construction Kit DC | `https://phet.colorado.edu/sims/html/circuit-construction-kit-dc/latest/circuit-construction-kit-dc_all.html` | Same URL | Arduino electricity/current/resistance foundations, interpreting circuit measurements | Official PhET build source contains a literal iframe embedding test and simulation source supports parent-frame load messaging. Use as a DC-circuit model, **not** as Arduino compiler or board/sensor simulator. `_all.html` is the multi-language production artifact naming convention. Current repo README says project consolidated into a monorepo and points to free hosted simulations; no live check. |
| Scratch Maze Starter | `https://scratch.mit.edu/projects/10128431/embed` | `https://scratch.mit.edu/projects/10128431/editor/` | VEX IQ/LEGO/VEX VR algorithms: sequencing, events, motion, loops, coordinates | Official Scratch starter-project dataset supplies Maze Starter ID10128431. Official source has an EmbedView with `/projects/<id>/embed` route. **Embedded player runs the published example; it is not an embedded full editor.** Open separate editor/remix to modify code; not VEX/LEGO hardware simulation. |
| MakeCode Arcade — Monster Truck Racer | `https://arcade.makecode.com/---run?id=_1yfTMtFAe5yC` | `https://arcade.makecode.com/#pub:_1yfTMtFAe5yC` | VEX/LEGO/VR event handling, conditionals and iteration via a game | Microsoft official games gallery supplies `_1yfTMtFAe5yC`. Official PXT source constructs `---run` simulator embeds and pub editor URLs; Arcade target declares `https://arcade.makecode.com/` as embedUrl. **Embedded simulator/player; edit copy separately.** It does not simulate a physical robot or run VEX/LEGO APIs. |

These four additions provide three new general programming/simulator providers plus one Arduino-specific provider with source evidence, complementing existing CircuitJS, AVR8js, MakeCode micro:bit and GearsBot.

## Additional useful entries (external-only until live embedding confirmed)

- **micro:bit Python Editor v3:** `https://python.microbit.org/v/3` (preferred external editor). Official Micro:bit Foundation README documents MicroPython + interactive simulator and stable release URL. Excellent for all Micro:bit lessons. Full editor iframe hosting-policy not verified; do not label confirmed embeddable. Its **simulator itself** has an explicit embed API at `https://python-simulator.usermbit.org/v/0.1/simulator.html`; this is not a ready standalone programming app: integration must flash Python via documented postMessage API and supply controls/terminal. API URLs are documented as unstable, so avoid a raw empty simulator iframe.
- **Open Roberta Lab:** `https://lab.open-roberta.org/?loadSystem=ev3dev` (generic EV3 NEPO robotics environment). Official URL-parameters wiki explicitly documents `?loadSystem=` and lists `ev3dev`, `microbit`, `uno`, etc. Source README includes SPIKE Prime/Pybricks cross-compiler support, but not proof of a full SPIKE simulator. Avoid naming EV3 simulation as an exact VEX IQ or SPIKE implementation. No official iframe integration support was found in inspected docs; external-only is the conservative option.
- **Blockly Games:** `https://blockly.games/maze?lang=vi` and `https://blockly.games/turtle?lang=vi`. Official repo README identifies blockly.games and App Engine config explicitly maps `/maze` and `/turtle`. Good sequencing/loop/angle practice. Hosting config inspected declares no X-Frame-Options/CSP, but current live hosting remains unverified; use external-only or clearly mark attempted embed with fallback. These are algorithm games, not hardware simulators.
- **Snap!:** `https://snap.berkeley.edu/snap/`. Official source explicitly implements `embedMode` and iframe-aware API. However, share/project embed mode needs an actual authored project; no verified public project selected. General editor external-only is preferable to invented IDs or embed flags. Good block/programming/coordinate practice; not hardware simulation.
- **Official vendor editors, external-only until independently checked:** VEX IQ `https://codeiq.vex.com/`, VEX VR `https://vr.vex.com/`, LEGO SPIKE `https://spike.legoeducation.com/`. No live availability, frame headers, browser/device support, license requirements or official iframe SDK verification was possible in this environment. VEX IQ/LEGO normally require real hardware for physical sensor/motor validation; VEX VR is a virtual-robot environment. Do not claim every playground is free/unlocked.
- **Tinkercad Circuits:** `https://www.tinkercad.com/circuits` external-only entry. Do not invent project-specific `/embed/` IDs or claim it works anonymously; no retrieved official embedding documentation for this provider.

## Evidence URLs

Wokwi:
- https://raw.githubusercontent.com/wokwi/wokwi-docs/main/docs/welcome.md — official Uno Hello World ID322062421191557714, supported features and personal/commercial distinction.
- https://github.com/wokwi/wokwi-features/issues/526 — literal `/share/embed/282702715864220173` iframe links, owner confirms old nonnumeric IDs removed and fixed.
- https://github.com/wokwi/wokwi-features/issues/115 — official issue about an embedded simulator scrolling during serial TX; further evidence an embed mode exists.

PhET:
- https://raw.githubusercontent.com/phetsims/chipper/main/templates/sim-iframe.html — literal Iframe Embedding Test template, naming `_all.html` artifact convention.
- https://raw.githubusercontent.com/phetsims/joist/main/js/Sim.ts — parent-window postMessageOnLoad support.
- https://raw.githubusercontent.com/phetsims/circuit-construction-kit-dc/main/README.md — official current status and hosted simulations site.

Scratch:
- https://raw.githubusercontent.com/scratchfoundation/scratch-www/develop/src/views/starter-projects/starter-projects.json — Maze Starter10128431; optional official Simple Circuit Simulation1106279050 and X and Y Coordinates1106739913.
- https://raw.githubusercontent.com/scratchfoundation/scratch-www/develop/src/views/preview/embed-view.jsx — official embedded project player implementation.
- https://raw.githubusercontent.com/scratchfoundation/scratch-www/develop/src/views/preview/embed.jsx — embed app bootstrap.

Microsoft MakeCode:
- https://raw.githubusercontent.com/microsoft/pxt/master/common-docs/share.md — explicit section Embedding into a blog or web site (project code/read-only editor/simulator).
- https://raw.githubusercontent.com/microsoft/pxt/master/webapp/src/app.tsx — ShareData embed URL generation at publishAsync, including simulatorRunString `---run`, pubId and editor share URL.
- https://raw.githubusercontent.com/microsoft/pxt-arcade/master/docs/games.md — official published game IDs including Monster Truck Racer `_1yfTMtFAe5yC`.
- https://raw.githubusercontent.com/microsoft/pxt-arcade/master/pxtarget.json — official target embedUrl/homeUrl.

Micro:bit Python:
- https://raw.githubusercontent.com/microbit-foundation/python-editor-v3/main/README.md
- https://raw.githubusercontent.com/microbit-foundation/python-editor-v3/main/docs/tech-overview.md — separately embedded simulator, MicroPython runtime and postMessage.
- https://raw.githubusercontent.com/microbit-foundation/micropython-microbit-v2-simulator/main/README.md — exact simulator embed URL, controls and API stability notice.

Open Roberta:
- https://raw.githubusercontent.com/wiki/OpenRoberta/openroberta-lab/URL-parameters.md — exact loadSystem URLs and valid robot names.
- https://raw.githubusercontent.com/OpenRoberta/openroberta-lab/develop/README.md — compiler/hardware details including SPIKE Prime/Pybricks.

Blockly Games / Snap:
- https://raw.githubusercontent.com/google/blockly-games/master/README.md
- https://raw.githubusercontent.com/google/blockly-games/master/appengine/app.yaml
- https://raw.githubusercontent.com/jmoenig/Snap/master/README.md
- https://raw.githubusercontent.com/jmoenig/Snap/master/src/gui.js — iframe APIs, embedMode detection and setEmbedMode.

## Implementation cautions that affect correctness

1. Keep platform labels honest: simulator/player versus editable app, robot surrogate versus vendor-specific API. Provide short lesson-specific tasks rather than only a button wall.
2. Prefer local bench as reliable default and require a user click before remote iframe creation. Retain local bench + external link when a provider is slow, blocked, needs login or changes embedding policy.
3. Restrict iframe creation to registry URLs, not arbitrary input; use HTTPS and noopener/noreferrer on separate-open links. Do not add user-entered credentials to iframe URLs.
4. Do not claim to grade or read code from a cross-origin iframe. Use the existing local quiz/journal completion rule and distinguish it from verification of a remote project.
5. Browser tests can validate URL selection, card state, click-to-load and fallback without accessing provider hosts. Label that validation as mocked/local; provider headers/content have not been tested live here.
