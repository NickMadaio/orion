import SwiftUI

/// The Home page's small personal universe.  Quick Open is not a toolbar: it
/// gives the user's own apps a little orbital field around Orion, while the
/// center remains clear for the hologram itself.
struct HomeLauncherSurface: View {
    @ObservedObject var settings: QuickOpenSettings
    var onAddApp: () -> Void
    var onManage: () -> Void
    @State private var hoveredItemID: UUID?
    @State private var isCustomizing = false
    @State private var dragPoints: [UUID: CGPoint] = [:]
    @State private var dragStartPoints: [UUID: CGPoint] = [:]
    @State private var draggingItemID: UUID?
    @AppStorage("orion.quickOpen.iconScale") private var iconScale = 1.0

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // The faint paths are intentionally incomplete: this should
                // feel like a constellation, not a mechanical dashboard.
                Circle()
                    .stroke(Color.cyan.opacity(0.08), style: StrokeStyle(lineWidth: 1, dash: [2, 10]))
                    .frame(width: min(geometry.size.width * 0.70, 610), height: min(geometry.size.height * 0.82, 390))
                Circle()
                    .stroke(Color.white.opacity(0.045), lineWidth: 1)
                    .frame(width: min(geometry.size.width * 0.48, 440), height: min(geometry.size.height * 0.61, 292))

                ForEach(Array(settings.items.enumerated()), id: \.element.id) { index, item in
                    let placement = orbitPlacement(for: index)
                    let savedX = item.orbitX ?? placement.x
                    let savedY = item.orbitY ?? placement.y
                    let center = dragPoints[item.id] ?? CGPoint(
                        x: geometry.size.width * savedX,
                        y: geometry.size.height * savedY
                    )
                    Button {
                        if !isCustomizing { settings.open(item) }
                    } label: {
                        VStack(spacing: 5) {
                            ZStack {
                                Circle().fill(Color(red: 0.04, green: 0.09, blue: 0.14).opacity(0.88))
                                Circle().stroke(
                                    hoveredItemID == item.id ? Color.cyan.opacity(0.78) : Color.white.opacity(0.16),
                                    lineWidth: hoveredItemID == item.id ? 1.5 : 1
                                )
                                QuickOpenTileIcon(item: item)
                            }
                            .frame(width: placement.size * iconScale, height: placement.size * iconScale)
                            .shadow(color: Color.cyan.opacity(draggingItemID == item.id ? 0.55 : (hoveredItemID == item.id ? 0.32 : 0.10)), radius: draggingItemID == item.id ? 20 : (hoveredItemID == item.id ? 13 : 6))

                            Text(item.name)
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(.white.opacity(hoveredItemID == item.id ? 0.90 : 0.52))
                                .lineLimit(1)
                                .opacity(hoveredItemID == item.id ? 1 : 0.66)
                        }
                        .frame(width: max(76, placement.size * iconScale + 22), height: placement.size * iconScale + 28)
                        .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .onHover { hoveredItemID = $0 ? item.id : nil }
                    .help(item.destination)
                    .rotationEffect(.degrees(isCustomizing ? Double((index % 3) - 1) * 2.0 : 0))
                    .scaleEffect(draggingItemID == item.id ? 1.16 : 1)
                    .opacity(draggingItemID == item.id ? 0.96 : 1)
                    .zIndex(draggingItemID == item.id ? 10 : 0)
                    .position(center)
                    .animation(.spring(response: 0.22, dampingFraction: 0.72), value: draggingItemID)
                    .simultaneousGesture(
                        DragGesture(minimumDistance: 1)
                            .onChanged { value in
                                guard isCustomizing else { return }
                                let origin = dragStartPoints[item.id] ?? CGPoint(
                                    x: geometry.size.width * savedX,
                                    y: geometry.size.height * savedY
                                )
                                dragStartPoints[item.id] = origin
                                draggingItemID = item.id
                                dragPoints[item.id] = CGPoint(
                                    x: min(geometry.size.width * 0.94, max(geometry.size.width * 0.06, origin.x + value.translation.width)),
                                    y: min(geometry.size.height * 0.91, max(geometry.size.height * 0.11, origin.y + value.translation.height))
                                )
                            }
                            .onEnded { value in
                                guard isCustomizing else { return }
                                let origin = dragStartPoints[item.id] ?? CGPoint(
                                    x: geometry.size.width * savedX,
                                    y: geometry.size.height * savedY
                                )
                                let point = CGPoint(
                                    x: min(geometry.size.width * 0.94, max(geometry.size.width * 0.06, origin.x + value.translation.width)),
                                    y: min(geometry.size.height * 0.91, max(geometry.size.height * 0.11, origin.y + value.translation.height))
                                )
                                settings.move(item.id, toX: point.x / geometry.size.width, y: point.y / geometry.size.height)
                                dragPoints[item.id] = nil
                                dragStartPoints[item.id] = nil
                                draggingItemID = nil
                            }
                    )
                    .contextMenu {
                        Button {
                            isCustomizing = true
                        } label: {
                            Label("Rearrange apps", systemImage: "arrow.up.and.down.and.arrow.left.and.right")
                        }
                        Divider()
                        Button(role: .destructive) {
                            settings.remove(id: item.id)
                        } label: {
                            Label("Delete \(item.name)", systemImage: "trash")
                        }
                    }
                }

                HStack {
                    Text("QUICK OPEN")
                        .font(.system(size: 10, weight: .semibold))
                        .tracking(2)
                        .foregroundStyle(.white.opacity(0.32))
                    Spacer()
                    if isCustomizing {
                        Text("DRAG TO ARRANGE")
                            .font(.system(size: 10, weight: .semibold))
                            .tracking(1.2)
                            .foregroundStyle(Color.cyan.opacity(0.72))
                        Button("Add app", action: onAddApp)
                            .buttonStyle(.plain)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Color.cyan.opacity(0.92))
                        Button("Manage", action: onManage)
                            .buttonStyle(.plain)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(.white.opacity(0.54))
                        Button("Done") { isCustomizing = false }
                            .buttonStyle(.plain)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color.cyan.opacity(0.92))
                    } else {
                        Button("Customize") { isCustomizing = true }
                            .buttonStyle(.plain)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Color.cyan.opacity(0.86))
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .frame(maxHeight: .infinity, alignment: .top)
            }
        }
    }

    private func orbitPlacement(for index: Int) -> OrbitPlacement {
        // A hand-tuned first ring preserves an attractive, lightly clustered
        // silhouette. Additional user-created actions spill into a calm outer
        // orbit rather than colliding with Orion.
        let primary: [OrbitPlacement] = [
            .init(x: 0.16, y: 0.34, size: 46), .init(x: 0.25, y: 0.16, size: 42),
            .init(x: 0.40, y: 0.10, size: 48), .init(x: 0.60, y: 0.12, size: 42),
            .init(x: 0.76, y: 0.20, size: 48), .init(x: 0.85, y: 0.42, size: 44),
            .init(x: 0.79, y: 0.67, size: 42), .init(x: 0.63, y: 0.84, size: 48),
            .init(x: 0.40, y: 0.87, size: 42), .init(x: 0.22, y: 0.72, size: 48),
            .init(x: 0.10, y: 0.55, size: 42), .init(x: 0.28, y: 0.49, size: 38),
            .init(x: 0.72, y: 0.51, size: 38), .init(x: 0.50, y: 0.94, size: 38),
        ]
        if index < primary.count { return primary[index] }
        let spillIndex = index - primary.count
        let angle = Double(spillIndex) * 2.399963229728653 // golden angle
        return OrbitPlacement(
            x: 0.5 + cos(angle) * 0.43,
            y: 0.5 + sin(angle) * 0.40,
            size: spillIndex.isMultiple(of: 2) ? 40 : 44
        )
    }
}

private struct OrbitPlacement {
    let x: Double
    let y: Double
    let size: CGFloat
}

/// Installed apps expose their genuine macOS icon locally. Website tiles keep
/// the user-selected emoji instead of sending saved destinations to a third
/// party just to fetch a favicon.
private struct QuickOpenTileIcon: View {
    let item: QuickOpenSettings.Item

    var body: some View {
        if let applicationIcon {
            Image(nsImage: applicationIcon)
                .resizable()
                .interpolation(.high)
                .scaledToFit()
                .padding(7)
        } else {
            Text(item.icon.isEmpty ? "✦" : item.icon)
                .font(.system(size: 24, weight: .medium))
                .foregroundStyle(.white.opacity(0.88))
        }
    }

    private var applicationIcon: NSImage? {
        guard item.destination.hasPrefix("app://") else { return nil }
        let bundleIdentifier = String(item.destination.dropFirst("app://".count))
        guard let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier) else { return nil }
        return NSWorkspace.shared.icon(forFile: appURL.path)
    }
}
