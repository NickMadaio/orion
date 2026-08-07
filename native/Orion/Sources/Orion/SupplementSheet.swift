import SwiftUI

/*
 The supplement list, in a sheet.

 On the Health tab the supplements are a COUNT and a button. The list lives
 here, because a tile that grows a row per supplement is a tile that eventually
 owns the screen — which is precisely what went wrong the last two times this
 tab was laid out.

 The dashboard answers "how many left today". This answers "which ones, and
 what am I taking". Two different questions, two different surfaces, and only
 the first one belongs on a screen you glance at.
*/

struct SupplementSheet: View {
    @ObservedObject var health: HealthLog
    var onClose: () -> Void

    @State private var name = ""
    @State private var dose = ""
    @State private var timeOfDay = "morning"

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().overlay(OrionTheme.line)

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    adder
                    if health.supplements.isEmpty {
                        empty
                    } else {
                        ForEach(health.supplementsByTime) { group in
                            VStack(alignment: .leading, spacing: 8) {
                                SectionRule(title: group.id,
                                            trailing: "\(taken(in: group.items))/\(group.items.count)")
                                ForEach(group.items) { supplement in
                                    row(supplement)
                                }
                            }
                        }
                    }
                }
                .padding(20)
            }
            .scrollContentBackground(.hidden)
        }
        .frame(width: 480, height: 560)
        .background {
            ZStack {
                VisualEffectBackground(material: .hudWindow)
                Color.black.opacity(0.30)
            }
            .ignoresSafeArea()
        }
        .preferredColorScheme(.dark)
    }

    private var header: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Supplements")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(OrionTheme.text)
                Text("\(health.takenToday.count) of \(health.supplements.count) taken today")
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.textDim)
            }
            Spacer()
            Button("Done", action: onClose)
                .buttonStyle(.plain)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.black)
                .padding(.horizontal, 16).padding(.vertical, 8)
                .background(Capsule().fill(.white))
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
    }

    private func row(_ supplement: Supplement) -> some View {
        let isTaken = health.takenToday.contains(supplement.id)
        return HStack(spacing: 11) {
            Button { health.toggleSupplement(supplement.id) } label: {
                Image(systemName: isTaken ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 17))
                    .foregroundStyle(isTaken ? OrionTheme.green : OrionTheme.textDim)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 1) {
                Text(supplement.name)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(isTaken ? OrionTheme.textDim : OrionTheme.text)
                    .strikethrough(isTaken, color: OrionTheme.textDim)
                if !supplement.dose.isEmpty {
                    Text(supplement.dose)
                        .font(OrionTheme.mono(10))
                        .foregroundStyle(OrionTheme.textDim)
                }
            }
            Spacer(minLength: 8)
            Button { health.removeSupplement(supplement.id) } label: {
                Image(systemName: "trash")
                    .font(.system(size: 10))
                    .foregroundStyle(OrionTheme.textDim)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background {
            RoundedRectangle(cornerRadius: 11, style: .continuous)
                .fill(.white.opacity(isTaken ? 0.02 : 0.055))
                .overlay {
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .strokeBorder(.white.opacity(0.08), lineWidth: 0.5)
                }
        }
    }

    private var adder: some View {
        VStack(alignment: .leading, spacing: 9) {
            SectionRule(title: "Add one")
            HStack(spacing: 8) {
                TextField("Name", text: $name)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13))
                    .foregroundStyle(OrionTheme.text)
                    .padding(.horizontal, 11).padding(.vertical, 9)
                    .background(field)
                TextField("Dose", text: $dose)
                    .textFieldStyle(.plain)
                    .font(OrionTheme.mono(12))
                    .foregroundStyle(OrionTheme.text)
                    .frame(width: 90)
                    .padding(.horizontal, 11).padding(.vertical, 9)
                    .background(field)
                    .onSubmit(add)
                Button("Add", action: add)
                    .buttonStyle(.plain)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.black)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(Capsule().fill(canAdd ? OrionTheme.violet : Color.white.opacity(0.2)))
                    .disabled(!canAdd)
            }
            Picker("", selection: $timeOfDay) {
                Text("Morning").tag("morning")
                Text("Lunch").tag("lunch")
                Text("Evening").tag("evening")
                Text("Anytime").tag("anytime")
            }
            .pickerStyle(.segmented)
            .labelsHidden()
        }
    }

    private var empty: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("Nothing set up yet.")
                .font(.system(size: 13))
                .foregroundStyle(OrionTheme.textSoft)
            Text("Add what you actually take. Or tell Orion — “I take ashwagandha at night”.")
                .font(OrionTheme.mono(10))
                .foregroundStyle(OrionTheme.textDim)
        }
        .padding(.top, 4)
    }

    private var field: some View {
        RoundedRectangle(cornerRadius: 9, style: .continuous)
            .fill(.white.opacity(0.06))
            .overlay {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .strokeBorder(.white.opacity(0.10), lineWidth: 0.5)
            }
    }

    private func taken(in items: [Supplement]) -> Int {
        items.filter { health.takenToday.contains($0.id) }.count
    }

    private var canAdd: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func add() {
        guard canAdd else { return }
        health.addSupplement(name, dose: dose, timeOfDay: timeOfDay)
        name = ""
        dose = ""
    }
}
