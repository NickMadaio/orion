// Node port of what the Mac app wraps around a message before it reaches ORION. Every function is pure;
// inputs (clock, session status, outreach rows, SCHEDULING.md text, routing mode) are injected.
//
//   agentRequest        AppState.agentRequest      app-context prefix + spoken suffix
//   continuationText    AppState.send              "(Continuing — …)" for the second half of a cut-off sentence
//   outreachPrefix      GatewayClient.recentOutreach / OutreachTracker
//   schedulingContext   SchedulingMemory.context
//   thinkingLevel       ThinkingPolicy.level
//   buildTurn           GatewayClient.ask          the full --message and --thinking value
//
// Parity with the real Swift is asserted by test/parity.test.mjs against goldens that
// native/Orion/Tests/run-gate-parity-test.sh produces from the real sources.
export { agentRequest, continuationText, buildTurn, describeSession, enforcementArmed, SPOKEN_SUFFIX, CONTINUATION_PREFIX } from "./lib/request.mjs";
export { outreachPrefix, outreachLabel, parseOutreach, initialTracker } from "./lib/outreach.mjs";
export { schedulingContext, localDigest, parseRoutingMode, servesSchedulingLocally } from "./lib/scheduling.mjs";
export { thinkingLevel, needsReasoning, struggled, BOOST_SECONDS } from "./lib/thinking.mjs";
export { extractReply, findPayload, stripANSI } from "./lib/reply.mjs";
export { quickAnswer, isResumeRequest } from "./lib/shortcuts.mjs";
