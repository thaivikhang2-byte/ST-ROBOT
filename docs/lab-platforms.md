# Lab integrations

## Restored original platforms

The original lab setup from commit `4b26e4a` is preserved. Existing lab URLs, iframe permissions and initial course selections are not gated behind a new origin/verification flag.

| Platform | Original URL | Default courses |
| --- | --- | --- |
| CircuitJS | https://www.falstad.com/circuit/circuitjs.html | Additional original Arduino option |
| AVR8js | https://www.falstad.com/circuit/avr8js/ | Arduino Uno |
| MakeCode micro:bit | https://makecode.microbit.org/#editor | micro:bit |
| GearsBot | https://gears.aposteriori.com.sg/ | VEX IQ, LEGO SPIKE Prime, VEXcode VR |

The original in-page numerical/logic bench remains available as the last choice. This is a simple model, not a substitute for a complete hardware simulator.

## Additional official iframe endpoints

Only embed routes are configured. There is no separate-editor button, external-only platform choice, popup fallback or platform-help link in the website.

| Addition | Configured iframe URL | Official source evidence |
| --- | --- | --- |
| Wokwi Uno | https://wokwi.com/share/embed/322062421191557714 | The Uno project ID appears in [official welcome docs](https://github.com/wokwi/wokwi-docs/blob/main/docs/welcome.md). The numeric `/share/embed/` route is documented in [official issue 526](https://github.com/wokwi/wokwi-features/issues/526). |
| PhET DC circuits | https://phet.colorado.edu/sims/html/circuit-construction-kit-dc/latest/circuit-construction-kit-dc_all.html | [Official iframe template](https://github.com/phetsims/chipper/blob/main/templates/sim-iframe.html) and [simulation source](https://github.com/phetsims/circuit-construction-kit-dc). |
| Scratch Maze Starter | https://scratch.mit.edu/projects/10128431/embed | Project ID from [Scratch starter-project data](https://github.com/scratchfoundation/scratch-www/blob/develop/src/views/starter-projects/starter-projects.json), route supported by the [official embedded player](https://github.com/scratchfoundation/scratch-www/blob/develop/src/views/preview/embed-view.jsx). |
| MakeCode Arcade | https://arcade.makecode.com/---run?id=_1yfTMtFAe5yC | Project ID from [Microsoft game gallery](https://github.com/microsoft/pxt-arcade/blob/master/docs/games.md); simulator embed supported by [PXT sharing](https://github.com/microsoft/pxt/blob/master/common-docs/share.md) and its URL generator. |

Scratch and Arcade frames run examples; they are not full VEX/LEGO hardware editors. PhET models DC circuits, not Arduino code. GearsBot remains an alternative robot environment rather than an exact VEX/LEGO emulator. These distinctions are retained in the lesson material.

New frames cannot open popup tabs or navigate the top page. A new platform that raises a frame load error is removed for the current session and the original course lab is restored. Original platforms retain their pre-change iframe behavior and are not removed by this extra handling. An iframe load event alone is not proof of successful third-party execution.

## Validation scope

Official source documentation supports the added routes. Direct provider requests from this managed environment failed at the network proxy CONNECT stage with HTTP 403; that is not evidence that the provider rejects website embedding. It must not be used to remove the user's original working labs.

The browser suite uses local iframe fixtures to verify all original URLs/defaults, the four added embed URLs, local benches, blocked-addition recovery, absence of external-tab buttons, responsive layout and existing course features. It does not claim live provider availability. The source list excludes full-editor-only candidates requiring a separate tab (VEX/LEGO vendor editors, Python Editor, Open Roberta) from the shipped lab menu.
