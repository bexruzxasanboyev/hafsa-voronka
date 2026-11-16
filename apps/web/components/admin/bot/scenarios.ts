import type { BotButtonKey, BotMessageKey } from "@funnel/shared";

export type ScenarioId = "newUser" | "returning" | "afterLesson" | "later";

export type ChatButton = { key: BotButtonKey; placement: "reply" | "inline" };

export type ChatTrigger =
  | {
      kind: "user";
      text: "start" | "wrote" | "later" | "other" | "day" | "picked" | "stale";
      context?: "notWatched" | "watched";
    }
  | { kind: "note"; note?: "buttonReady" | "hourBefore" | "chosenTime" };

export type ScenarioCard = { key: BotMessageKey; trigger?: ChatTrigger; buttons: ChatButton[] };

const watch: ChatButton = { key: "watchButton", placement: "inline" };
const channel: ChatButton = { key: "channelButton", placement: "inline" };
const inline = (key: BotButtonKey): ChatButton => ({ key, placement: "inline" });

export const scenarioOrder: ScenarioId[] = ["newUser", "returning", "afterLesson", "later"];

export const scenarios: Record<ScenarioId, ScenarioCard[]> = {
  newUser: [
    { key: "watchPrompt", trigger: { kind: "user", text: "start" }, buttons: [watch] },
  ],
  returning: [
    { key: "welcome", trigger: { kind: "user", text: "start", context: "notWatched" }, buttons: [watch] },
    { key: "welcomeBack", trigger: { kind: "user", text: "start", context: "watched" }, buttons: [watch, channel] },
    { key: "fallback", trigger: { kind: "user", text: "wrote" }, buttons: [watch] },
    { key: "rolloutPrompt", trigger: { kind: "note" }, buttons: [watch] },
  ],
  afterLesson: [{ key: "completion", trigger: { kind: "note" }, buttons: [channel] }],
  later: [
    {
      key: "laterAsk",
      trigger: { kind: "user", text: "later" },
      buttons: [inline("laterTonight"), inline("laterTomorrowMorning"), inline("laterTomorrowEvening"), inline("laterOther")],
    },
    {
      key: "laterPickDay",
      trigger: { kind: "user", text: "other" },
      buttons: [inline("dayToday"), inline("dayTomorrow"), inline("dayAfterTomorrow")],
    },
    { key: "laterPickHour", trigger: { kind: "user", text: "day" }, buttons: [] },
    { key: "laterConfirmed", trigger: { kind: "user", text: "picked" }, buttons: [] },
    { key: "laterTooLate", trigger: { kind: "user", text: "later" }, buttons: [watch] },
    { key: "reopenPreReminder", trigger: { kind: "note", note: "hourBefore" }, buttons: [] },
    { key: "reopenNow", trigger: { kind: "note", note: "chosenTime" }, buttons: [inline("reopenWatchButton")] },
    { key: "remindNow", trigger: { kind: "note", note: "chosenTime" }, buttons: [inline("remindWatchButton")] },
    { key: "offerClosed", trigger: { kind: "user", text: "stale" }, buttons: [] },
    { key: "laterAck", trigger: { kind: "user", text: "later" }, buttons: [] },
  ],
};

export function buttonUsage(key: BotButtonKey) {
  return Object.values(scenarios)
    .flat()
    .filter((card) => card.buttons.some((button) => button.key === key)).length;
}

export type BotMessageGroupId = "core" | "later" | "system";

export type BotMessageGroupEntry = {
  key: BotMessageKey;
  group: BotMessageGroupId;
  step?: number;
};

export const botMessageGroups: BotMessageGroupEntry[] = [
  { key: "watchPrompt", group: "core" },
  { key: "completion", group: "core" },
  { key: "welcome", group: "core" },
  { key: "welcomeBack", group: "core" },
  { key: "rolloutPrompt", group: "core" },
  { key: "laterAsk", group: "later", step: 1 },
  { key: "laterPickDay", group: "later", step: 2 },
  { key: "laterPickHour", group: "later", step: 3 },
  { key: "laterConfirmed", group: "later", step: 4 },
  { key: "reopenPreReminder", group: "later", step: 5 },
  { key: "reopenNow", group: "later", step: 6 },
  { key: "fallback", group: "system" },
  { key: "remindNow", group: "system" },
  { key: "laterTooLate", group: "system" },
  { key: "offerClosed", group: "system" },
  { key: "laterAck", group: "system" },
];

export function scenarioCardFor(key: BotMessageKey): ScenarioCard | undefined {
  return Object.values(scenarios)
    .flat()
    .find((card) => card.key === key);
}
