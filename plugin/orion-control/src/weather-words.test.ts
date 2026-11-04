import { afterEach, describe, expect, it, vi } from "vitest";
import { readWeather } from "./ambient.js";
import { finalizeReply } from "./reply-sanitize.js";
import { fahrenheitWords, toF } from "./weather-words.js";

// 2026-11-03: "tomorrow in london will be partly cloudy… high of 13°C (55°F)" was spoken aloud and the TTS stumbled
// over "F". Every temperature is Fahrenheit, said as the full words.

describe("fahrenheitWords", () => {
  it("rewrites a Celsius-with-Fahrenheit pair to the Fahrenheit number in words", () => {
    expect(fahrenheitWords("Tomorrow in London will be partly cloudy with light drizzle, high of 13°C (55°F) and low of 8°C (46°F)."))
      .toBe("Tomorrow in London will be partly cloudy with light drizzle, high of 55 degrees Fahrenheit and low of 46 degrees Fahrenheit.");
  });
  it("converts Celsius alone and keeps 'high of'", () => {
    expect(fahrenheitWords("high 13°C")).toBe("high of 55 degrees Fahrenheit");
    expect(fahrenheitWords("a low of -3°C tonight")).toBe("a low of 27 degrees Fahrenheit tonight");
    expect(fahrenheitWords("20 degrees Celsius")).toBe("68 degrees Fahrenheit");
  });
  it("spells out a bare F and a range", () => {
    expect(fahrenheitWords("It is 55°F, feels like 50 F.")).toBe("It is 55 degrees Fahrenheit, feels like 50 degrees Fahrenheit.");
    expect(fahrenheitWords("46–55°F")).toBe("46 to 55 degrees Fahrenheit");
    expect(fahrenheitWords("55 degrees F")).toBe("55 degrees Fahrenheit");
  });
  it("is idempotent and leaves times, percentages and other text alone", () => {
    const said = "a high of 55 degrees Fahrenheit and a low of 46";
    expect(fahrenheitWords(said)).toBe(said);
    for (const t of ["Gym at 5 PM, 50% chance of rain.", "meeting at 9:30 F1 room", "CS2100 lecture at 3", "Pack 2 jackets, 70% likely"]) expect(fahrenheitWords(t)).toBe(t);
  });
  it("never reads a food macro triple as a temperature (2026-11-04: '8F' was spoken as '8 degrees Fahrenheit')", () => {
    for (const t of [
      "~190 kcal · 6P 23C 8F (nature valley protein salted caramel nut bar; assumed standard single-serving bar size). Log it?",
      "Logged ~570 kcal — nature valley protein bar: 18P 69C 24F. Fix anything?",
      "Logged chicken burrito as lunch: 667 kcal, 27P 99C 18F. 1450 kcal today.",
      "about 42P 70C 18F and 650 kcal, a high protein lunch",
    ]) expect(fahrenheitWords(t)).toBe(t);
    expect(finalizeReply("~190 kcal · 6P 23C 8F (a bar). Log it?", [])).not.toMatch(/Fahrenheit/);
  });
  it("a bare F with no degree sign converts only with weather context", () => {
    expect(fahrenheitWords("It is 55 F outside, feels like 50 F.")).toBe("It is 55 degrees Fahrenheit outside, feels like 50 degrees Fahrenheit.");
    expect(fahrenheitWords("Forecast: 46 F tonight")).toBe("Forecast: 46 degrees Fahrenheit tonight");
    expect(fahrenheitWords("high 55F, low 46F")).toBe("high of 55 degrees Fahrenheit, low of 46 degrees Fahrenheit");
    expect(fahrenheitWords("Today is 8F")).toBe("Today is 8F");
  });
  it("°F always converts, even beside macros", () => {
    expect(fahrenheitWords("6P 23C 8F, and it is 55°F")).toBe("6P 23C 8F, and it is 55 degrees Fahrenheit");
  });
  it("toF rounds", () => { expect(toF(13)).toBe(55); expect(toF(8.4)).toBe(47); });
});

describe("finalizeReply", () => {
  it("normalises temperatures on the way out", () => {
    expect(finalizeReply("Right now it's 13°C (55°F) out.", [])).toBe("Right now it's 55 degrees Fahrenheit out.");
  });
});

describe("weather_now output", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("gives Fahrenheit only, in words, with the instruction", async () => {
    const bodies = [
      { results: [{ name: "London", admin1: "England", country_code: "GB", latitude: 51.5, longitude: -0.1 }] },
      { current: { time: "2026-11-03T10:00", temperature_2m: 10, apparent_temperature: 8, weather_code: 2, wind_speed_10m: 5 },
        daily: { time: ["2026-11-03"], temperature_2m_max: [13], temperature_2m_min: [8], weather_code: [2], precipitation_probability_max: [5] },
        hourly: { time: [], precipitation_probability: [], precipitation: [] } },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => bodies.shift() })));
    const report = await readWeather({ location: "London" });
    expect(report.summary).toContain("50 degrees Fahrenheit");
    expect(report.summary).toContain("a high of 55 degrees Fahrenheit and a low of 46");
    expect(JSON.stringify({ ...report, say: "" })).not.toMatch(/°|Celsius|highC|lowC|temperatureC/);
    expect(report.say).toMatch(/degrees Fahrenheit/);
  });
});
