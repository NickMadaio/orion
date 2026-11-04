// Is he actually getting ready for bed? (2026-11-04) Nick: "looking at light levels, he can see I'm not actually ready for bed."
// Two signals: the Mac in use (focus-activity) and the room still lit (orion-light). Lights on AND on the Mac is "not winding down", which
// is what makes the firm rung come sooner. Unknown light is never read as lit or dark, and a display-brightness proxy never counts
// (ORION's own dimming would read as a dark room, and its absence as a bright one).
export const ACTIVE_MINUTES = 10;

const macUp = (mac) => {
  const idle = mac?.idleSeconds == null ? NaN : Number(mac.idleSeconds);
  return mac?.locked !== true && mac?.displayAsleep !== true && Number.isFinite(idle) && idle < ACTIVE_MINUTES * 60;
};

export function readiness({ mac, phone, light } = {}) {
  const onMac = macUp(mac);
  const age = phone?.usedMinutesAgo;
  const onPhone = age != null && Number.isFinite(Number(age)) && Number(age) <= ACTIVE_MINUTES;
  const lightsOn = light?.state === "bright" && light?.source === "als";
  const notWinding = onMac && lightsOn;
  const reasons = [...(onMac ? ["mac"] : []), ...(onPhone ? ["phone"] : []), ...(lightsOn ? ["lights"] : [])];
  return {
    windingDown: !onMac && !onPhone && !lightsOn,
    notWinding, onMac, onPhone, lightsOn, reasons,
    say: notWinding ? "your lights are still on and you're on the Mac" : "",
  };
}
