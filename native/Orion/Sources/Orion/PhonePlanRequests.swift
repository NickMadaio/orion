import Foundation
import MobileCore

/*
 "Plan my day" from the phone (2026-09-28).

 The phone link leaves a request in today-plan-request.json (PlanRequestFile);
 this picks it up and does exactly what Nick would do on the Tasks tab --
 refresh Calendar and the Orion Reminders list, preview, accept -- in one step,
 then writes the outcome back into the file for the link to publish. Undo is
 the same undo the Tasks tab offers, so a plan made from the phone is never a
 one-way door.

 Checked by the dashboard's ticker, which lives as long as the app does: the
 dashboard window is created at launch and only ever hidden, never closed.
*/
@MainActor
final class PhonePlanRequests {
    private var handling: String?
    /// Long enough for Reminders to answer a refresh; the planner refuses stale sources.
    private let settleTime: TimeInterval = 2.5

    func check(model: TodayPlanModel, agenda: AppleCalendarSync, reminders: AppleRemindersSync) {
        model.reloadIfChanged()
        guard handling == nil, model.loaded, let request = PlanRequestFile.pending(),
              let action = LinkPlanAction(rawValue: request.action) else { return }
        handling = request.id
        report(request, .working, nil)
        switch action {
        case .undo:
            model.undo { [weak self] failure in
                self?.finish(request, failure: failure, success: "Put back the plan from before the last change.")
            }
        case .plan, .replan:
            // Fresh readings first: the planner refuses anything older than ten minutes.
            agenda.refresh(); reminders.refresh()
            DispatchQueue.main.asyncAfter(deadline: .now() + settleTime) { [weak self] in
                model.refresh(agenda: agenda, reminders: reminders) { usable in
                    guard let self else { return }
                    guard usable else {
                        self.finish(request, failure: model.sourceMessage, success: "")
                        return
                    }
                    model.dismissProposal()
                    model.preview(action == .plan && model.current() == nil ? .plan : .replan)
                    guard model.proposal != nil else {
                        self.finish(request, failure: model.error ?? "The planner could not make a plan.", success: "")
                        return
                    }
                    model.accept { failure in
                        self.finish(request, failure: failure, success: Self.summary(model.current()))
                    }
                }
            }
        }
    }

    private func finish(_ request: LinkSnapshot.PlanRequest, failure: String?, success: String) {
        report(request, failure == nil ? .done : .failed, failure ?? success)
        handling = nil
    }

    private func report(_ request: LinkSnapshot.PlanRequest, _ state: LinkSnapshot.PlanRequest.State, _ message: String?) {
        var updated = request
        updated.state = state
        updated.message = message
        // Only overwrite our own request; a newer one from the phone wins.
        guard PlanRequestFile.read()?.id == request.id else { return }
        try? PlanRequestFile.write(updated)
    }

    static func summary(_ plan: TodayPlan?) -> String {
        guard let plan else { return "Planned." }
        let tasks = plan.blocks.filter { $0.kind == .task }.count
        let deferred = plan.deferredIDs.count
        var parts = ["\(tasks) task\(tasks == 1 ? "" : "s") placed", "\(plan.freeMinutes) min kept free"]
        if deferred > 0 { parts.append("\(deferred) didn't fit") }
        return parts.joined(separator: " · ")
    }
}
