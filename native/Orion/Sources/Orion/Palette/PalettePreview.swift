//
//  The right-hand pane: an app's icon and running state, the to-do's detail, a calculation, or ORION's inline answer.
//

import AppKit
import PaletteKit
import SwiftUI

struct PalettePreview: View {
    let item: PaletteItem?
    let output: PaletteOutput?
    let running: [PaletteRunningApp]
    /// Renders: no ScrollView (ImageRenderer cannot draw one), long text is clipped.
    var animated = true

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let output { outputPane(output) } else if let item { itemPane(item) }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 20).padding(.vertical, 18)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: ORION's output

    @ViewBuilder private func outputPane(_ output: PaletteOutput) -> some View {
        switch output {
        case .thinking(let question):
            kicker("ORION", OrionTheme.lavender)
            quote(question)
            HStack(spacing: 8) {
                ProgressView().controlSize(.small).tint(OrionTheme.accent)
                Text("thinking…").font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.textSoft)
            }
        case .answer(let question, let text):
            HStack(spacing: 8) { PaletteOrb(size: 11); kicker("ORION", OrionTheme.lavender) }
            quote(question)
            body(text)
            hint("↩ open in chat   esc close")
        case .planning:
            kicker("CLOSE UNUSED APPS", OrionTheme.orange)
            HStack(spacing: 8) {
                ProgressView().controlSize(.small).tint(OrionTheme.orange)
                Text("working out the plan…").font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.textSoft)
            }
        case .plan(let say, let closes):
            kicker("THE PLAN", OrionTheme.orange)
            Text("Would close").font(.system(size: 12)).foregroundStyle(OrionTheme.textSoft)
            ForEach(closes.prefix(6), id: \.self) { name in
                HStack(spacing: 8) {
                    Circle().fill(OrionTheme.orange).frame(width: 4, height: 4)
                    Text(name).font(.system(size: 14)).foregroundStyle(OrionTheme.text)
                }
            }
            body(say)
            hint("↩ close them   esc keep everything")
        case .working(let label):
            kicker("WORKING", OrionTheme.accent)
            HStack(spacing: 8) {
                ProgressView().controlSize(.small).tint(OrionTheme.accent)
                Text(label).font(.system(size: 13)).foregroundStyle(OrionTheme.textSoft)
            }
        case .result(let text):
            kicker("DONE", OrionTheme.green)
            body(text)
            hint("↩ close")
        }
    }

    // MARK: A row

    @ViewBuilder private func itemPane(_ item: PaletteItem) -> some View {
        switch item.action {
        case .openApp(let path): appPane(item, path: path, state: "NOT RUNNING", hint: "↩ open   ⌘K more")
        case .switchApp(let id, _, let path):
            let front = running.first { $0.bundleID == id }?.frontmost == true
            appPane(item, path: path, state: front ? "IN FRONT" : "RUNNING", hint: "↩ switch   ⌘Q quit   ⌘K more")
        case .todoDone:
            kicker(item.urgent ? "OVERDUE TO-DO" : "TO-DO", item.hue)
            Text(item.title).font(OrionTheme.display(19)).foregroundStyle(OrionTheme.text).fixedSize(horizontal: false, vertical: true)
            Text(item.subtitle).font(OrionTheme.mono(10.5)).foregroundStyle(item.urgent ? OrionTheme.red : OrionTheme.textSoft)
            hint("↩ mark done   ⌘K more")
        case .copy:
            kicker("RESULT", OrionTheme.green)
            Text(item.title).font(OrionTheme.display(40, .light)).foregroundStyle(OrionTheme.text).lineLimit(1).minimumScaleFactor(0.4)
            Text(item.subtitle).font(OrionTheme.mono(10.5)).foregroundStyle(OrionTheme.textSoft)
        case .ask(let text):
            HStack(spacing: 8) { PaletteOrb(size: 11); kicker("ASK ORION", OrionTheme.lavender) }
            if !text.isEmpty { quote(text) }
            Text("Sent the way a typed summon is. The answer lands here.").font(.system(size: 12)).foregroundStyle(OrionTheme.textSoft)
            hint("↩ ask   ⌘↩ ask from any row")
        case .addTodo(let title):
            kicker("NEW TO-DO", item.hue)
            Text(title).font(OrionTheme.display(19)).foregroundStyle(OrionTheme.text).fixedSize(horizontal: false, vertical: true)
            hint("↩ add it to your list")
        default:
            VStack(alignment: .leading, spacing: 12) {
                Image(systemName: item.symbol).font(.system(size: 22, weight: .light)).foregroundStyle(item.hue)
                    .frame(width: 56, height: 56)
                    .background(Circle().fill(item.hue.opacity(0.10)))
                    .overlay(Circle().strokeBorder(item.hue.opacity(0.5), lineWidth: 1))
                    .shadow(color: item.hue.opacity(0.3), radius: 10)
                Text(item.title).font(OrionTheme.display(19)).foregroundStyle(OrionTheme.text).fixedSize(horizontal: false, vertical: true)
                if !item.subtitle.isEmpty { Text(item.subtitle).font(.system(size: 12)).foregroundStyle(OrionTheme.textSoft) }
                kicker(item.section.kicker, item.hue)
                hint("↩ run   ⌘K more")
            }
        }
    }

    private func appPane(_ item: PaletteItem, path: String, state: String, hint text: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(nsImage: NSWorkspace.shared.icon(forFile: path))
                .resizable().frame(width: 72, height: 72)
                .shadow(color: item.hue.opacity(0.35), radius: 14)
            Text(item.title).font(OrionTheme.display(20)).foregroundStyle(OrionTheme.text).lineLimit(2)
            HStack(spacing: 7) {
                Circle().fill(state == "NOT RUNNING" ? OrionTheme.textDim : OrionTheme.green).frame(width: 5, height: 5)
                    .shadow(color: state == "NOT RUNNING" ? .clear : OrionTheme.green.opacity(0.9), radius: 3)
                Text(state).font(OrionTheme.mono(9, .semibold)).tracking(1.8).foregroundStyle(OrionTheme.textSoft)
            }
            Text((path as NSString).abbreviatingWithTildeInPath).font(OrionTheme.mono(9)).foregroundStyle(OrionTheme.textDim)
                .lineLimit(2).truncationMode(.middle)
            hint(text)
        }
    }

    // MARK: Pieces

    private func kicker(_ text: String, _ hue: Color) -> some View {
        Text(text).font(OrionTheme.mono(8.5, .semibold)).tracking(2.0).foregroundStyle(hue)
    }

    private func quote(_ text: String) -> some View {
        Text(text).font(.system(size: 12)).foregroundStyle(OrionTheme.textDim).lineLimit(2).fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private func body(_ text: String) -> some View {
        let label = Text(text).font(.system(size: 13.5)).foregroundStyle(OrionTheme.text).lineSpacing(3)
            .fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
        if animated { ScrollView { label }.scrollIndicators(.hidden) } else { label.lineLimit(12) }
    }

    private func hint(_ text: String) -> some View {
        Text(text).font(OrionTheme.mono(9)).foregroundStyle(OrionTheme.textDim).padding(.top, 4)
    }
}
