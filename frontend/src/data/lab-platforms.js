// Platform URLs use provider-supported embed modes.
// The micro:bit editor uses the official controller protocol for editable projects.
window.STROBOT_LAB_PLATFORMS = {
    "circuit": {
        "name": "CircuitJS · Mạch điện",
        "mode": "embed",
        "languages": "Mô phỏng mạch analog",
        "url": "https://www.falstad.com/circuit/circuitjs.html",
        "sourceUrl": "https://www.falstad.com/circuit/",
        "embedSupport": "existing"
    },
    "avr": {
        "name": "AVR8js · Arduino LED",
        "mode": "embed",
        "languages": "Arduino C/C++ · AVR",
        "url": "https://www.falstad.com/circuit/avr8js/",
        "sourceUrl": "https://github.com/wokwi/avr8js",
        "embedSupport": "existing"
    },
    "python": {
        "name": "micro:bit Python Editor",
        "mode": "embed",
        "languages": "MicroPython · Soạn thảo · Mô phỏng · Tải HEX",
        "url": "https://python.microbit.org/v/3/?controller=1&flag=noWelcome&l=en",
        "embedUrl": "https://python.microbit.org/v/3/?controller=1&flag=noWelcome&l=en",
        "externalUrl": "https://python.microbit.org/v/3/",
        "sourceUrl": "https://github.com/microbit-foundation/python-editor-v3/blob/v3.1.17/src/fs/host.ts",
        "embedSupport": "official",
        "controller": "microbit-python"
    },
    "gears": {
        "name": "GearsBot · Robot 3D",
        "mode": "embed",
        "languages": "Blockly · Python · robot ảo",
        "url": "https://gears.aposteriori.com.sg/",
        "sourceUrl": "https://github.com/QuirkyCort/gears",
        "embedSupport": "existing"
    },
    "wokwi": {
        "name": "Wokwi · Arduino Uno",
        "mode": "external",
        "languages": "Arduino C/C++ · editor ở tab riêng",
        "url": "https://wokwi.com/projects/322062421191557714",
        "sourceUrl": "https://docs.wokwi.com/",
        "embedSupport": "official",
        "externalUrl": "https://wokwi.com/projects/322062421191557714"
    },
    "phet": {
        "name": "PhET · Mạch điện DC",
        "mode": "embed",
        "languages": "Thí nghiệm điện trực quan",
        "url": "https://phet.colorado.edu/sims/html/circuit-construction-kit-dc/latest/circuit-construction-kit-dc_all.html",
        "embedUrl": "https://phet.colorado.edu/sims/html/circuit-construction-kit-dc/latest/circuit-construction-kit-dc_all.html",
        "sourceUrl": "https://phet.colorado.edu/en/simulations/circuit-construction-kit-dc",
        "embedSupport": "official"
    },
    "local": {
        "name": "Bàn thí nghiệm trong bài",
        "mode": "local",
        "languages": "Mô hình tương tác · không cần mạng"
    }
};

window.STROBOT_COURSE_LABS = {
    "arduino": [
        "circuit",
        "avr",
        "wokwi",
        "phet",
        "local"
    ],
    "microbit": [
        "python",
        "local"
    ],
    "vex-iq": [
        "gears",
        "local"
    ],
    "lego-spike": [
        "gears",
        "local"
    ],
    "vex-vr": [
        "gears",
        "local"
    ]
};
