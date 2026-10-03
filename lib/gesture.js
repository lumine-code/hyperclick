const Config = require("./config");

function modifierHeld(event) {
  return event.altKey === true;
}

function mouseActivation(event) {
  return event.button === 0 && modifierHeld(event);
}

function hoverDelay() {
  return Config.get("hoverDelay") ?? 0;
}

module.exports = { modifierHeld, mouseActivation, hoverDelay };
