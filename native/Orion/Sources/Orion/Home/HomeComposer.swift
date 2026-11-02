import OrionViews
import SwiftUI

/*
 The Home composer: wide, pinned to the bottom, with a soft blue rim that drifts slowly round it. The rim
 runs on the shared AmbientTimeline, so it stands still (holding its phase) when the window is hidden or covered,
 in Low Power Mode and under Reduce Motion. The bloom under it is static and blurred once, never per frame.

 The one quiet line under it ("LISTENING", "THINKING", a focus session's state and controls) appears only when there
 is something to say; an idle, ready ORION needs no caption.

 Plain values in, closures out, so it renders without an AppState; HomeTab wires it to the real one.
*/

/// The quiet line under the composer. Nil parts are not shown; an all-nil line is not shown at all.
struct HomeComposerLine {
    struct Phase { let title: String; let detail: String; let tint: Color }
    struct Control { let title: String; let run: () -> Void }

    var phase: Phase?
    var focus: String?
    var controls: [Control] = []

    var isEmpty: Bool { phase == nil && focus == nil }
}

struct HomeComposerBar: View {
    @Binding var text: String
    var focus: FocusState<Bool>.Binding
    let listening: Bool
    let line: HomeComposerLine
    let onVoice: () -> Void
    let onChat: () -> Void
    let onSend: () -> Void
    /// Renders: draw the rim at a fixed phase, and the field as its placeholder (ImageRenderer cannot draw an
    /// AppKit text field).
    var animated = true

    private static let corner: CGFloat = 20
    private static let prompt = "Tell ORION what you need"
    // Centred on blue (wave 13; Nick: "can we center that more blue rather than its dominant purple"): cyan, sky,
    // deep electric blue, periwinkle, one short touch of violet, and back. No rose or amber.
    private static let deepBlue = Color(red: 0.20, green: 0.42, blue: 1.0)
    static let spectrum: [Color] = [OrionTheme.accent, OrionTheme.blue, deepBlue, OrionTheme.lavender,
                                    OrionTheme.violet, deepBlue, OrionTheme.accent]

    var body: some View {
        VStack(spacing: 12) {
            field
                .background(bloom)
                .overlay(rim)
            if !line.isEmpty {
                status.transition(.opacity)
            }
        }
        .animation(OrionMotion.hover, value: canSend)
    }

    // MARK: Field

    private var field: some View {
        HStack(spacing: 14) {
            Button(action: onVoice) {
                Image(systemName: listening ? "waveform" : "mic")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(listening ? OrionTheme.accent : OrionTheme.textSoft)
                    .frame(width: 34, height: 34)
                    .overlay(Circle().strokeBorder(listening ? OrionTheme.accent.opacity(0.7) : Color.white.opacity(0.10),
                                                   lineWidth: listening ? 1 : 0.8))
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .help(listening ? "Stop listening" : "Talk to ORION")
            .accessibilityLabel(listening ? "Stop listening" : "Talk to ORION")

            if animated {
                TextField(Self.prompt, text: $text, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.system(size: 15))
                    .lineLimit(1...4)
                    .focused(focus)
                    .foregroundStyle(OrionTheme.text)
                    .onSubmit(onSend)
            } else {
                Text(text.isEmpty ? Self.prompt : text)
                    .font(.system(size: 15))
                    .foregroundStyle(text.isEmpty ? OrionTheme.textDim : OrionTheme.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button(action: onChat) {
                Image(systemName: "bubble.left.and.text.bubble.right")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(OrionTheme.textSoft)
                    .frame(width: 32, height: 32)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .help("Open chat")
            .accessibilityLabel("Open chat")

            Button(action: onSend) {
                Image(systemName: "arrow.up")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(canSend ? OrionTheme.text : OrionTheme.textDim)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(Color.white.opacity(canSend ? 0.12 : 0.04)))
                    .overlay(Circle().strokeBorder(Color.white.opacity(canSend ? 0.35 : 0.10), lineWidth: 0.8))
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
            .accessibilityLabel("Send")
        }
        .padding(.leading, 14)
        .padding(.trailing, 12)
        .padding(.vertical, 11)
        .background(RoundedRectangle(cornerRadius: Self.corner, style: .continuous).fill(OrionTheme.ink.opacity(0.62)))
    }

    /// The light the composer sits in: static, so its blur is drawn once.
    private var bloom: some View {
        RoundedRectangle(cornerRadius: Self.corner, style: .continuous)
            .fill(LinearGradient(colors: Self.spectrum.map { $0.opacity(0.55) }, startPoint: .leading, endPoint: .trailing))
            .blur(radius: 28)
            .opacity(0.32)
            .padding(.horizontal, 30)
            .offset(y: 4)
            .allowsHitTesting(false)
    }

    /// The drifting rim: three strokes of one slowly turning gradient, fine to soft. No blur, so a frame is cheap.
    private var rim: some View {
        AmbientTimeline(fps: 20, running: animated, stillTime: 6) { time in
            let gradient = AngularGradient(colors: Self.spectrum, center: .center, angle: .degrees(time * 15))
            let shape = RoundedRectangle(cornerRadius: Self.corner, style: .continuous)
            ZStack {
                shape.stroke(gradient, lineWidth: 10).opacity(0.05)
                shape.stroke(gradient, lineWidth: 4).opacity(0.16)
                shape.stroke(gradient, lineWidth: 1).opacity(focus.wrappedValue ? 0.95 : 0.7)
            }
        }
        .allowsHitTesting(false)
    }

    // MARK: Status

    private var status: some View {
        HStack(spacing: 18) {
            if let phase = line.phase {
                HStack(spacing: 8) {
                    Circle().fill(phase.tint).frame(width: 5, height: 5).shadow(color: phase.tint.opacity(0.9), radius: 4)
                    Text(phase.title).font(OrionTheme.mono(9, .semibold)).tracking(2.2).foregroundStyle(OrionTheme.textSoft)
                    Text(phase.detail).font(OrionTheme.mono(9)).foregroundStyle(OrionTheme.textDim).lineLimit(1)
                }
            }
            if let focusText = line.focus {
                HStack(spacing: 10) {
                    Text(focusText).font(OrionTheme.mono(9, .semibold)).tracking(2).foregroundStyle(OrionTheme.textSoft).lineLimit(1)
                    ForEach(line.controls.indices, id: \.self) { index in
                        Button(line.controls[index].title, action: line.controls[index].run)
                            .buttonStyle(.plain)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(OrionTheme.accent)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var canSend: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}
