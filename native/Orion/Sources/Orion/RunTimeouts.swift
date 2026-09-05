import Foundation

/*
 One contract for how long a turn may take, instead of three numbers that
 disagree.

 Before this file there were three ceilings on one turn, written in three
 places, and nothing checked that they were compatible:

   • `GatewayClient.timeoutSeconds` = 180        the `--timeout` handed to the CLI
   • `agents.defaults.timeoutSeconds` = 600      in ~/.openclaw/openclaw.json
   • `VoiceTuning.absoluteThinkingCeiling` = 210 the app's `.thinking` watchdog

 Two of those relationships were wrong in ways with visible symptoms.

 1. The client's own hard read deadline was `180 + 30 = 210`, and the watchdog
    ceiling was ALSO 210. A tie, not an ordering. Whichever timer's runloop got
    there first decided what Nick saw, so the same failure produced either the
    specific gateway error or the watchdog's generic "That question never came
    back" — at random. A backstop that races the thing it is backing up is not
    a backstop.

 2. The 600 in the config is a DEFAULT, and it only stays harmless while the app
    keeps passing `--timeout` explicitly. Delete that one argument — an easy
    thing to do while tidying an argument list — and the agent would run to 600s
    while the client gave up at 210s. The work would complete, into a pipe
    nobody is reading, and Nick would be told it never came back. That is the
    exact fault he reported: "i cant tell if hes actually working".

 So the numbers live here, once, and `violations()` states the ORDERING they
 have to satisfy rather than the literals. A test asserts `violations()` is
 empty, which means a future edit that moves any single number without moving
 its neighbours fails a named check instead of silently reintroducing a tie.

 The ordering, outermost last:

     agentTimeout  <  terminateAt  <  killAt  <  clientReadDeadline  <  watchdogCeiling
       300s           320s            325s        360s                   420s

 Each layer only exists for the case where the one inside it failed to fire, so
 each needs real air above the last — `margin` — not one shared second.
 */
enum RunTimeouts {

    // MARK: The numbers

    /// What the app hands the CLI as `--timeout`. The agent's own limit.
    ///
    /// Raised from 180s. Nick timed out asking Orion to update himself, which is
    /// a genuinely multi-minute job — a build, a copy, a relaunch. 180s was not
    /// a safety limit for that, it was a guarantee of failure. The floor under a
    /// long turn is now the progress feed telling him it is still moving, not a
    /// short deadline pretending nothing slow is legitimate.
    static let agentTimeout: TimeInterval = 300

    /// Grace after `agentTimeout` before the app SIGTERMs the subprocess. The
    /// agent is meant to honour its own timeout inside this window and exit
    /// with a real error, which is a far better thing to show than a kill.
    static let terminateGrace: TimeInterval = 20

    /// Grace after SIGTERM before SIGKILL. `terminate()` is a request; a wedged
    /// process is under no obligation to take it, and on 2026-08-12 one did not.
    static let killGrace: TimeInterval = 5

    /// How long the app waits on the subprocess's stdout before abandoning the
    /// read thread. Must outlast the kill: a killed child closes its pipe, and
    /// we want to observe that rather than time out first and never learn why.
    static let clientReadDeadline: TimeInterval = 360

    /// The `.thinking` watchdog's ceiling — the floor under everything above,
    /// for the case where the read never returns at all because a grandchild of
    /// the agent inherited the pipe and outlived it. Nothing below this can
    /// help there; killing the agent does not close a handle someone else holds.
    static let watchdogCeiling: TimeInterval = 420

    /// Required air between one layer and the next.
    static let margin: TimeInterval = 30

    /// The value in `~/.openclaw/openclaw.json` at `agents.defaults.timeoutSeconds`.
    ///
    /// Recorded, not read at runtime, and deliberately so: the app must never
    /// depend on it, because depending on it is the failure this file exists to
    /// prevent. It is here only so `violations()` can say out loud that our
    /// explicit `--timeout` is what makes the config irrelevant.
    static let configuredAgentDefault: TimeInterval = 600

    // MARK: Derived instants, measured from the start of the turn

    static var terminateAt: TimeInterval { agentTimeout + terminateGrace }
    static var killAt: TimeInterval { terminateAt + killGrace }

    // MARK: The progress contract

    /// Nick must see something meaningful this soon after pressing send.
    ///
    /// This cannot come from the audit log. One `openclaw audit` invocation
    /// measured 2.4–2.8s on this machine (2026-09-05, three runs), so the first
    /// poll cannot even RETURN inside this budget. The first lines are therefore
    /// local and synthetic — see `RunProgressModel` — and audit refines them.
    static let firstStatusWithin: TimeInterval = 2

    /// The longest stretch of unexplained quiet the feed may show.
    ///
    /// After this, the feed says so in words. Silence is the one thing Nick
    /// cannot read: "still working" and "wedged" look identical, and the whole
    /// point of this work is to make them look different.
    static let silenceBudget: TimeInterval = 8

    /// How long after audit reports the run FINISHED the client may still be
    /// blocked before we call it wedged.
    ///
    /// This is the first real liveness signal `.thinking` has ever had. Until
    /// now `stallAfter` was `.infinity` because the agent said nothing until it
    /// was done. The audit log says it out of band: if the run is recorded
    /// finished and `GatewayClient.ask` has still not returned, the subprocess
    /// is wedged on its pipe — the 2026-08-12 signature exactly — and there is
    /// no reason to wait out the ceiling.
    static let wedgeGraceAfterRunEnd: TimeInterval = 20

    /// Measured cost of one `openclaw audit` invocation on this machine
    /// (2026-09-05, three runs: 2.4-2.8s). Recorded so `auditPollInterval`
    /// below is checked against a real number instead of picked by feel.
    static let measuredAuditInvocationCost: TimeInterval = 2.8

    /// How often `RunProgressModel`'s poller may call `openclaw audit`.
    ///
    /// Polling faster than one invocation can return just queues audit calls
    /// up behind each other without ever catching up — the same shape of
    /// mistake this whole file exists to name and check for.
    static let auditPollInterval: TimeInterval = 3

    // MARK: The ordering, as a check rather than a comment

    /// Empty when the contract holds. Each entry names one broken relationship.
    ///
    /// Relationships, not literals: the test that calls this stays true when a
    /// number is deliberately changed and its neighbours are changed with it,
    /// and fails the moment one moves alone.
    static func violations() -> [String] {
        var found: [String] = []

        if terminateAt <= agentTimeout {
            found.append("terminate (\(Int(terminateAt))s) must come after the agent's own timeout (\(Int(agentTimeout))s)")
        }
        if killAt <= terminateAt {
            found.append("kill (\(Int(killAt))s) must come after terminate (\(Int(terminateAt))s)")
        }
        if clientReadDeadline < killAt + margin {
            found.append("client read deadline (\(Int(clientReadDeadline))s) must be at least \(Int(margin))s past the kill (\(Int(killAt))s)")
        }
        if watchdogCeiling < clientReadDeadline + margin {
            found.append("watchdog ceiling (\(Int(watchdogCeiling))s) must be at least \(Int(margin))s past the client read deadline (\(Int(clientReadDeadline))s)")
        }
        if agentTimeout < RunTimeouts.silenceBudget * 2 {
            found.append("agent timeout (\(Int(agentTimeout))s) is too short to be worth reporting progress about")
        }
        if firstStatusWithin >= silenceBudget {
            found.append("first status (\(Int(firstStatusWithin))s) must arrive well inside the silence budget (\(Int(silenceBudget))s)")
        }
        if auditPollInterval <= measuredAuditInvocationCost {
            found.append("audit poll interval (\(auditPollInterval))s must exceed the measured cost of one invocation (\(measuredAuditInvocationCost)s)")
        }
        return found
    }

    /// One line for `orion-doctor` and the design note.
    static var summary: String {
        "agent \(Int(agentTimeout))s · terminate \(Int(terminateAt))s · kill \(Int(killAt))s · "
            + "client \(Int(clientReadDeadline))s · watchdog \(Int(watchdogCeiling))s"
    }
}
