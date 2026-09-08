import Foundation
import MobileCore
import SessionService

final class TodayPlanModel: ObservableObject {
    @Published private(set) var document = TodayPlanDocument()
    @Published private(set) var proposal: TodayPlan?
    @Published var preferences = TodayPlanPreferences()
    @Published private(set) var inputs: TodayPlanInputs?
    @Published private(set) var sourceMessage = "Waiting for calendar and Orion Reminders."
    @Published private(set) var error: String?
    @Published private(set) var isSaving = false
    @Published private(set) var loaded = false
    private let store: TodayPlanStore
    private let queue = DispatchQueue(label: "orion.today-plan.store", qos: .userInitiated)
    private var fetchGeneration = 0
    private var proposalRevision = 0
    private var operationID = UUID()
    @Published private var edits: [String: Int] = [:]

    init(store: TodayPlanStore = TodayPlanStore()) { self.store = store }

    func load() {
        guard !loaded else { return }
        queue.async { [weak self] in
            guard let self else { return }
            let result = Result { try self.store.load() }
            DispatchQueue.main.async {
                switch result {
                case .success(let value):
                    self.document = value
                    if let saved = value.current { self.preferences = saved.preferences }
                    self.loaded = true
                case .failure(let failure): self.error = failure.localizedDescription
                }
            }
        }
    }

    func current(at now: Date = Date()) -> TodayPlan? {
        guard let plan = document.current, plan.timeZone == TimeZone.current.identifier,
              Calendar.current.isDate(plan.day, inSameDayAs: now) else { return nil }
        return plan
    }

    func sourcesMatch(_ plan: TodayPlan, at now: Date) -> Bool {
        inputs?.isFresh(at: now) == true && inputs?.fingerprint == plan.sourceFingerprint
    }

    func refresh(agenda: AppleCalendarSync, reminders: AppleRemindersSync) {
        fetchGeneration += 1
        let generation = fetchGeneration
        guard agenda.access.isGranted, reminders.access.isGranted,
              let taskReadAt = reminders.lastSyncedAt, reminders.lastError == nil,
              let interval = Calendar.current.dateInterval(of: .day, for: Date()) else {
            inputs = nil; proposal = nil
            sourceMessage = "Calendar or Orion Reminders is unavailable. Check its connection in Settings."
            return
        }
        let tasks = reminders.tasks
        let requestedZone = TimeZone.current.identifier
        agenda.fetch(interval: interval) { [weak self] events, failure in
            guard let self, generation == self.fetchGeneration else { return }
            guard failure == nil, requestedZone == TimeZone.current.identifier,
                  Calendar.current.isDate(interval.start, inSameDayAs: Date()) else {
                self.inputs = nil; self.proposal = nil
                self.sourceMessage = failure ?? "The day or time zone changed. Refresh the plan sources."
                return
            }
            do {
                let value = try TodayPlanInputs.make(events: events, tasks: tasks, calendarReadAt: Date(),
                                                    tasksReadAt: taskReadAt, now: Date(), defaultMinutes: self.preferences.defaultTaskMinutes)
                self.receive(value)
            } catch { self.inputs = nil; self.proposal = nil; self.sourceMessage = error.localizedDescription }
        }
    }

    /// The asynchronous EventKit adapter and the model share one snapshot boundary.
    func receive(_ value: TodayPlanInputs) {
        if inputs?.fingerprint != value.fingerprint { proposal = nil }
        inputs = value
        sourceMessage = "Calendar and Orion Reminders checked. Task durations are editable estimates."
    }

    func setEstimate(_ taskID: String, minutes: Int) { edits[taskID] = minutes; proposal = nil }
    func estimate(for id: String) -> Int {
        edits[id] ?? current()?.tasks.first(where: { $0.id == id })?.minutes ?? preferences.defaultTaskMinutes
    }

    enum Change { case plan, replan, finish(String), moreTime(String), pin(String), unpin(String), unpinAll }

    func preview(_ change: Change, now: Date = Date()) {
        guard loaded, !isSaving else { return }
        do {
            guard let inputs, inputs.isFresh(at: now) else { throw TodayPlanError.staleSources }
            let old = current(at: now)
            var complete = Set(old?.completedIDs ?? [])
            var durations = edits
            var favored: String?
            // A successful full source snapshot can confirm completion/deletion.
            // Release those slots in the preview; failed reads never reach here.
            let unfinishedSources = Set(inputs.tasks.filter { !$0.completedInSource }.map(\.id))
            var pins = (old?.blocks ?? []).filter { $0.pinned && unfinishedSources.contains($0.sourceID ?? "") }.compactMap { block in
                block.sourceID.map { TodayPlanPin(taskID: $0, start: block.start, end: block.end) }
            }
            let reason: String
            switch change {
            case .plan: reason = "A day proposal from your calendar, tasks and chosen time budgets."
            case .replan: reason = "Replanned from now. Unfinished task blocks keep their duration estimates; commitments and off-hours stay protected."
            case .finish(let id):
                guard old?.blocks.contains(where: { $0.kind == .task && $0.sourceID == id }) == true else { throw TodayPlanError.unknownBlock }
                complete.insert(id)
                pins.removeAll { $0.taskID == id }
                reason = "Finished a block. The remaining day is proposed again; the source reminder is unchanged."
            case .pin(let id):
                guard let block = old?.blocks.first(where: { $0.kind == .task && $0.sourceID == id }), !block.pinned else { throw TodayPlanError.unknownBlock }
                pins.append(TodayPlanPin(taskID: id, start: block.start, end: block.end))
                reason = "Pin this task's current slot. Future revisions must preserve it or report a conflict."
            case .unpin(let id):
                guard old?.blocks.contains(where: { $0.pinned && $0.sourceID == id }) == true else { throw TodayPlanError.unknownBlock }
                pins.removeAll { $0.taskID == id }
                reason = "Release this task's pinned slot and preview where the remaining work fits."
            case .unpinAll:
                pins = []
                reason = "Release all pinned slots. Review the new times before applying this revision."
            case .moreTime(let id):
                guard let block = old?.blocks.first(where: { $0.kind == .task && $0.sourceID == id }) else { throw TodayPlanError.unknownBlock }
                durations[id] = max(0, Int(ceil(block.end.timeIntervalSince(max(now, block.start)) / 60))) + 15
                favored = id
                reason = "Requested 15 more minutes for a task. Any changed slots are shown before you apply the revision."
            }
            let tasks = inputs.tasks.map { task in
                TodayPlanTask(id: task.id, title: task.title,
                              minutes: durations[task.id] ?? old?.tasks.first(where: { $0.id == task.id })?.minutes ?? preferences.defaultTaskMinutes,
                              priority: favored == task.id ? -100 : task.priority, due: task.due, completedInSource: task.completedInSource)
            }
            proposal = try TodayPlanScheduler.propose(now: now, timeZone: inputs.timeZone, preferences: preferences,
                                                     tasks: tasks, commitments: inputs.commitments, completedIDs: complete, pins: pins,
                                                     reason: reason, sourceFingerprint: inputs.fingerprint)
            proposalRevision = document.revision; operationID = UUID(); error = nil
        } catch { proposal = nil; self.error = error.localizedDescription }
    }

    func accept(now: Date = Date()) {
        guard let plan = proposal, let inputs, !isSaving,
              inputs.isFresh(at: now), plan.sourceFingerprint == inputs.fingerprint,
              plan.preferences == preferences, (0...60).contains(now.timeIntervalSince(plan.generatedAt)) else {
            error = "The preview or its sources changed. Create a fresh preview before applying it."; return
        }
        let revision = proposalRevision, id = operationID
        save { try self.store.accept(plan, expectedRevision: revision, operationID: id) }
    }

    func undo() {
        guard current() != nil, document.hasUndo, !isSaving else { return }
        let revision = document.revision, id = UUID()
        save { try self.store.undo(expectedRevision: revision, operationID: id) }
    }

    private func save(_ operation: @escaping () throws -> TodayPlanDocument) {
        isSaving = true; error = nil
        queue.async { [weak self] in
            let result = Result(catching: operation)
            // A competing writer wins honestly. Reload that revision so the user
            // can review and retry without restarting the app.
            var recovered: TodayPlanDocument?
            if case .failure(let failure) = result, failure as? TodayPlanError == .revisionConflict {
                recovered = try? self?.store.load()
            }
            let refreshed = recovered
            DispatchQueue.main.async {
                guard let self else { return }
                self.isSaving = false
                switch result {
                case .success(let value):
                    self.document = value; self.proposal = nil; self.edits = [:]
                    if let plan = value.current { self.preferences = plan.preferences }
                case .failure(let failure):
                    self.error = failure.localizedDescription
                    if let refreshed {
                        self.document = refreshed; self.proposal = nil
                        if let plan = refreshed.current { self.preferences = plan.preferences }
                    }
                }
            }
        }
    }
    func dismissProposal() { proposal = nil }
}
