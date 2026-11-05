// w20 R3 (gate #51): a nutrition or fitness fact question is the model's to answer, never a day summary.
import { describe, expect, it } from "vitest";
import { isHealthKnowledgeAsk, isKnowledgeAsk } from "./knowledge-ask.js";

describe("health knowledge questions", () => {
  it.each([
    "is it bad to eat rice after the gym or whats the deal with carbs at night",
    "is creatine actually worth it or nah",
    "whats the deal with fasted cardio",
    "does caffeine after 4 ruin your sleep",
    "is it ok to skip stretching after lifting",
    "whats the deal with protein shakes before bed",
    "why do my muscles get sore the day after leg day",
    "should i eat before or after a workout",
  ])("%s", (m) => {
    expect(isHealthKnowledgeAsk(m)).toBe(true);
    expect(isKnowledgeAsk(m)).toBe(true);
  });
  it.each([
    "is there a gym block on my calendar today",
    "when is my gym session tomorrow",
    "do i have gym today",
    "how many calories have i had today",
    "is my gym on tonight",
    "move gym to 7",
    "did i eat enough protein today",
  ])("%s stays his own day or log", (m) => {
    expect(isHealthKnowledgeAsk(m)).toBe(false);
  });
});
