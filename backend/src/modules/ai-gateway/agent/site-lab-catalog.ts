// Snapshot of frontend/src/data/lab-platforms.js; equality is checked in site-learning-context.spec.ts.
export const siteLabPlatforms: Record<string, { name: string; mode: string; languages: string; url?: string; externalUrl?: string }> = {
  "circuit": {
    "name": "CircuitJS · Mạch điện",
    "mode": "embed",
    "languages": "Mô phỏng mạch analog",
    "url": "https://www.falstad.com/circuit/circuitjs.html"
  },
  "avr": {
    "name": "AVR8js · Arduino LED",
    "mode": "embed",
    "languages": "Arduino C/C++ · AVR",
    "url": "https://www.falstad.com/circuit/avr8js/"
  },
  "python": {
    "name": "micro:bit Python Editor",
    "mode": "embed",
    "languages": "MicroPython · Soạn thảo · Mô phỏng · Tải HEX",
    "url": "https://python.microbit.org/v/3/?controller=1&flag=noWelcome&l=en",
    "externalUrl": "https://python.microbit.org/v/3/"
  },
  "gears": {
    "name": "GearsBot · Robot 3D",
    "mode": "embed",
    "languages": "Blockly · Python · robot ảo",
    "url": "https://gears.aposteriori.com.sg/"
  },
  "wokwi": {
    "name": "Wokwi · Arduino Uno",
    "mode": "embed",
    "languages": "Arduino C/C++ · mô phỏng số",
    "url": "https://wokwi.com/share/embed/322062421191557714",
    "externalUrl": "https://wokwi.com/projects/322062421191557714"
  },
  "phet": {
    "name": "PhET · Mạch điện DC",
    "mode": "embed",
    "languages": "Thí nghiệm điện trực quan",
    "url": "https://phet.colorado.edu/sims/html/circuit-construction-kit-dc/latest/circuit-construction-kit-dc_all.html"
  },
  "scratch": {
    "name": "Scratch · Mê cung",
    "mode": "embed",
    "languages": "Khối lệnh · chạy dự án mẫu",
    "url": "https://scratch.mit.edu/projects/10128431/embed",
    "externalUrl": "https://scratch.mit.edu/projects/10128431/editor/"
  },
  "arcade": {
    "name": "MakeCode Arcade · Trò chơi",
    "mode": "embed",
    "languages": "Blocks · TypeScript · game simulator",
    "url": "https://arcade.makecode.com/---run?id=_1yfTMtFAe5yC",
    "externalUrl": "https://arcade.makecode.com/#pub:_1yfTMtFAe5yC"
  },
  "local": {
    "name": "Bàn thí nghiệm trong bài",
    "mode": "local",
    "languages": "Mô hình tương tác · không cần mạng"
  }
};
export const siteCourseLabs: Readonly<Record<string, readonly string[]>> = {
  "arduino": [
    "circuit",
    "avr",
    "wokwi",
    "phet",
    "local"
  ],
  "microbit": [
    "python",
    "scratch",
    "arcade",
    "local"
  ],
  "vex-iq": [
    "gears",
    "scratch",
    "arcade",
    "local"
  ],
  "lego-spike": [
    "gears",
    "scratch",
    "arcade",
    "local"
  ],
  "vex-vr": [
    "gears",
    "scratch",
    "arcade",
    "local"
  ]
};
