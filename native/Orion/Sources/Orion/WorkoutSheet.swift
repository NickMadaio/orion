import SwiftUI

/*
 The full workout logger, in a sheet.

 Pulled out of the Health tab because it was permanently occupying a third of a
 screen for something touched a few times a week, next to counters ticked every
 day. A workout is a MODE — you are in the gym, logging set after set — not
 ambient information, so it gets a surface that opens when you are in that mode
 and closes when you are not.

 Same store as everywhere else, so a set typed here and a set spoken to Orion
 are the same record. Nothing about this sheet is a second source of truth.
*/

struct WorkoutSheet: View {
    @ObservedObject var health: HealthLog
    var onClose: () -> Void

    @State private var exerciseName = ""
    @State private var weight = ""
    @State private var reps = ""
    @FocusState private var repsFocused: Bool

    private var session: WorkoutSession? { health.todaysWorkout }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().overlay(OrionTheme.line)

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    entry
                    if let session, !session.exercises.isEmpty {
                        logged(session)
                    } else {
                        empty
                    }
                }
                .padding(20)
            }
            .scrollContentBackground(.hidden)
        }
        .frame(width: 540, height: 620)
        // Same correction as the dashboard: real behind-window blur underneath,
        // tint over the top. See VisualEffectBackground.
        .background {
            ZStack {
                VisualEffectBackground(material: .hudWindow)
                Color.black.opacity(0.34)
            }
            .ignoresSafeArea()
        }
        .preferredColorScheme(.dark)
    }

    private var header: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Today's workout")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(OrionTheme.text)
                if let session, session.totalSets > 0 {
                    Text("\(session.totalSets) sets · \(Int(session.volume)) total load")
                        .font(OrionTheme.mono(10))
                        .foregroundStyle(OrionTheme.textDim)
                } else {
                    Text("Nothing logged yet")
                        .font(OrionTheme.mono(10))
                        .foregroundStyle(OrionTheme.textDim)
                }
            }
            Spacer()
            Button("Done", action: onClose)
                .buttonStyle(.plain)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(OrionTheme.ink)
                .padding(.horizontal, 16).padding(.vertical, 8)
                .background(Capsule().fill(.white))
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
    }

    private var entry: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionRule(title: "Add a set")
            HStack(spacing: 8) {
                TextField("Exercise", text: $exerciseName)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13))
                    .foregroundStyle(OrionTheme.text)
                    .padding(.horizontal, 11).padding(.vertical, 9)
                    .background(field)
                TextField("lb", text: $weight)
                    .textFieldStyle(.plain)
                    .font(OrionTheme.mono(13))
                    .foregroundStyle(OrionTheme.text)
                    .frame(width: 70)
                    .padding(.horizontal, 11).padding(.vertical, 9)
                    .background(field)
                TextField("reps", text: $reps)
                    .textFieldStyle(.plain)
                    .font(OrionTheme.mono(13))
                    .foregroundStyle(OrionTheme.text)
                    .frame(width: 60)
                    .padding(.horizontal, 11).padding(.vertical, 9)
                    .background(field)
                    .focused($repsFocused)
                    .onSubmit(add)
                Button("Add", action: add)
                    .buttonStyle(.plain)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(OrionTheme.ink)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(Capsule().fill(canAdd ? OrionTheme.green : Color.white.opacity(0.2)))
                    .disabled(!canAdd)
            }

            if !health.recentExerciseNames.isEmpty {
                // One tap instead of retyping "incline dumbbell press" — the
                // friction that stops people logging after the second set.
                HStack(spacing: 6) {
                    ForEach(health.recentExerciseNames.prefix(6), id: \.self) { name in
                        Button { exerciseName = name } label: {
                            Text(name)
                                .font(OrionTheme.mono(9))
                                .foregroundStyle(OrionTheme.textSoft)
                                .padding(.horizontal, 9).padding(.vertical, 5)
                                .background(Capsule().stroke(OrionTheme.line, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                    Spacer(minLength: 0)
                }
            }

            if let previous = health.previousBest(exerciseName), !exerciseName.isEmpty {
                Text("Last \(previous.day): \(previous.set.label) — beat it.")
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.orange)
            }
        }
    }

    @ViewBuilder private func logged(_ session: WorkoutSession) -> some View {
        SectionRule(title: "Logged", trailing: "\(session.totalSets) sets")
        ForEach(session.exercises) { exercise in
            OrionPanel(padding: 14) {
                HStack {
                    Text(exercise.name)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(OrionTheme.text)
                    Spacer()
                    Text("\(Int(exercise.volume)) vol")
                        .font(OrionTheme.mono(10))
                        .foregroundStyle(OrionTheme.textDim)
                }
                ForEach(Array(exercise.sets.enumerated()), id: \.element.id) { index, set in
                    HStack(spacing: 10) {
                        Text("\(index + 1)")
                            .font(OrionTheme.mono(9, .semibold))
                            .foregroundStyle(OrionTheme.textDim)
                            .frame(width: 14, alignment: .trailing)
                        Text(set.label)
                            .font(OrionTheme.mono(12, .semibold))
                            .foregroundStyle(OrionTheme.text)
                        Spacer()
                        Button {
                            health.removeSet(exerciseID: exercise.id, setID: set.id)
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(OrionTheme.textDim)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }

    private var empty: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("No sets yet today.")
                .font(.system(size: 13))
                .foregroundStyle(OrionTheme.textDim)
            Text("You can also just say it: “incline chest, 135 for 8, 145 for 6, 155 for 4”.")
                .font(OrionTheme.mono(10))
                .foregroundStyle(OrionTheme.textDim)
        }
        .padding(.top, 4)
    }

    private var field: some View {
        RoundedRectangle(cornerRadius: 9).fill(OrionTheme.cardRaised)
            .overlay(RoundedRectangle(cornerRadius: 9).stroke(OrionTheme.line, lineWidth: 1))
    }

    private var canAdd: Bool {
        !exerciseName.trimmingCharacters(in: .whitespaces).isEmpty
            && Double(weight.trimmingCharacters(in: .whitespaces)) != nil
            && (Int(reps.trimmingCharacters(in: .whitespaces)) ?? 0) > 0
    }

    private func add() {
        guard canAdd,
              let value = Double(weight.trimmingCharacters(in: .whitespaces)),
              let count = Int(reps.trimmingCharacters(in: .whitespaces))
        else { return }
        health.logSet(exercise: exerciseName, weight: value, reps: count)
        // Exercise and weight stay put; only reps clears. Sets come in runs of
        // the same lift, and clearing everything means retyping it every time.
        reps = ""
        repsFocused = true
    }
}
