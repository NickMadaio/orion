import ThinkingOrbsKit
import AppKit
import SwiftUI
import EventKit
import SessionService

/// The Home page during a focus block. It keeps Orion's restrained instrument
/// language without recreating a concept image literally: the clock, source
/// state, session controls, and guard authorization are the hierarchy.
struct FocusSessionHome: View {
    let hologram: HologramModel
    @ObservedObject var model: SessionTabModel
    var isPreview = false
    var onExitPreview: (() -> Void)?
    var onDismiss: (() -> Void)?
    /// Tuck the session into the floating bar and use the rest of ORION (2026-10-06).
    var onMinimize: (() -> Void)?
    @State private var pendingGuard: GuardProposal?

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let height = proxy.size.height
            let leftX = max(70, width * 0.06)
            let leftWidth = min(470, width * 0.31)
            let rightCenter = width * 0.67
            let rightWidth = min(790, width * 0.51)
            let constellationSize = min(leftWidth * 0.78, height * 0.30)
            let dialSize = min(575, height * 0.57, rightWidth * 0.76)
            let mediaHeight = min(380, height * 0.42)

            ZStack(alignment: .topLeading) {
                background

                sessionHeader(width: width - 92)
                    .position(x: width / 2, y: 36)

                identity
                    .frame(width: leftWidth, alignment: .leading)
                    .position(x: leftX + leftWidth / 2, y: height * 0.12)

                // ORION's own hologram (the orb-centred one), not a stand-in.
                ZStack {
                    Circle().fill(RadialGradient(colors: [FocusPalette.cyan.opacity(0.16), .clear],
                                                 center: .center, startRadius: 0, endRadius: constellationSize * 0.6))
                    HologramView(model: hologram)
                }
                .frame(width: constellationSize, height: constellationSize)
                .position(x: leftX + leftWidth * 0.5, y: height * 0.29)

                SessionDayStrip()
                    .frame(width: leftWidth, height: height * 0.12, alignment: .topLeading)
                    .position(x: leftX + leftWidth / 2, y: height * 0.505)

                musicSurface
                    .frame(width: leftWidth, height: mediaHeight)
                    .position(x: leftX + leftWidth / 2, y: height * 0.75)

                modeHeading(width: rightWidth)
                    .position(x: rightCenter, y: height * 0.095)

                FocusTimerDial(
                    diameter: dialSize,
                    progress: displayDialProgress,
                    remaining: clock(displayRemaining),
                    phase: isPreview ? "FOCUS 01" : model.focusBlockLabel
                )
                .contentShape(Circle())
                .onTapGesture {
                    if !isPreview { model.toggleSessionPause() }
                }
                .help(model.headline == "Paused" ? "Resume session" : "Pause session")
                .position(x: rightCenter, y: height * 0.43)

                timingMetrics
                    .position(x: rightCenter, y: height * 0.765)

                focusGuard
                    .frame(width: rightWidth, height: min(144, height * 0.15))
                    .position(x: rightCenter, y: height * 0.89)
            }
            .frame(width: width, height: height)
            .overlay {
                RoundedRectangle(cornerRadius: 19, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.18), lineWidth: 1)
                    .padding(1)
                    .allowsHitTesting(false)
            }
            .clipShape(RoundedRectangle(cornerRadius: 19, style: .continuous))
            .sheet(item: $pendingGuard) { proposal in
                GuardSetupSheet(proposal: proposal) { mode, bundleIDs in
                    model.armGuard(mode, allowing: bundleIDs)
                    pendingGuard = nil
                } onCancel: {
                    model.dismissGuardSetup()
                    pendingGuard = nil
                }
            }
            .onAppear { presentProactiveGuardIfNeeded() }
            .onReceive(model.$guardSetupRequest) { _ in presentProactiveGuardIfNeeded() }
        }
    }

    // MARK: - Window and identity

    private func sessionHeader(width: CGFloat) -> some View {
        HStack(spacing: 14) {
            Text("ORION")
                .font(OrionTheme.mono(12, .semibold))
                .tracking(5.5)
                .foregroundStyle(FocusPalette.cyan)
            Rectangle()
                .fill(FocusPalette.cyan.opacity(0.45))
                .frame(width: 34, height: 1)
            Text(isPreview ? "SESSION PREVIEW" : model.focusBlockLabel)
                .font(OrionTheme.mono(8, .medium))
                .tracking(1.8)
                .foregroundStyle(OrionTheme.textDim)

            Spacer()

            if isPreview {
                Button("EXIT PREVIEW") { onExitPreview?() }
                    .buttonStyle(.plain)
            } else {
                sessionControls
            }
        }
        .font(OrionTheme.mono(9, .semibold))
        .tracking(1.5)
        .foregroundStyle(OrionTheme.textDim)
        .frame(width: width)
        .padding(.bottom, 12)
        .overlay(alignment: .bottom) {
            LinearGradient(colors: [FocusPalette.cyan.opacity(0.38), .white.opacity(0.07), .clear],
                           startPoint: .leading, endPoint: .trailing)
                .frame(height: 1)
        }
    }

    /// Any of his Music playlists, started in one click; Music otherwise works as normal.
    private var playlistPicker: some View {
        Menu {
            if model.musicPlaylists.isEmpty { Text("Open Music to see your playlists") }
            ForEach(model.musicPlaylists, id: \.self) { name in Button(name) { model.playPlaylist(name) } }
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "music.note.list").font(.system(size: 8, weight: .semibold))
                Text("PLAYLIST")
                Image(systemName: "chevron.down").font(.system(size: 6, weight: .bold)).opacity(0.7)
            }
            .font(OrionTheme.mono(7, .semibold))
            .tracking(1.2)
            .foregroundStyle(FocusPalette.cyan)
            .padding(.horizontal, 9)
            .frame(height: 22)
            .background(Capsule().fill(FocusPalette.cyan.opacity(0.08)))
            .overlay(Capsule().stroke(FocusPalette.cyan.opacity(0.24), lineWidth: 1))
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .onAppear { model.loadPlaylists() }
        .help("Play one of your playlists")
    }

    private var sessionControls: some View {
        HStack(spacing: 18) {
            if let onMinimize {
                Button { onMinimize() } label: { Label("MINIMIZE", systemImage: "rectangle.bottomthird.inset.filled") }
                    .help("Keep the session running and go back to ORION")
            }
            Button(model.headline == "Paused" ? "RESUME" : "PAUSE") {
                model.toggleSessionPause()
            }
            Button("FINISH EARLY") {
                model.finishEarly()
            }
        }
        .buttonStyle(.plain)
        .font(OrionTheme.mono(9, .semibold))
        .tracking(1.5)
        .foregroundStyle(OrionTheme.textDim)
    }

    private var identity: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("CURRENT OBJECTIVE")
                .font(OrionTheme.mono(9, .semibold))
                .tracking(2.8)
                .foregroundStyle(FocusPalette.cyan.opacity(0.72))

            Text(isPreview ? "Deep work" : (model.task ?? "Focus"))
                .font(.system(size: 25, weight: .light))
                .foregroundStyle(FocusPalette.warmWhite)
                .lineLimit(1)

            HStack(spacing: 9) {
                Circle()
                    .fill(FocusPalette.cyan)
                    .frame(width: 6, height: 6)
                    .shadow(color: FocusPalette.cyan.opacity(0.75), radius: 5)
                Text(isPreview ? "ACTIVE · FOCUS 01" : "\(model.headline.uppercased()) · \(model.focusBlockLabel)")
                    .font(OrionTheme.mono(8, .medium))
                    .tracking(1.5)
                    .foregroundStyle(OrionTheme.textDim)
            }
        }
    }

    private func modeHeading(width: CGFloat) -> some View {
        HStack(spacing: 25) {
            FocusFadingRule()
            Text("LIVE FOCUS CLOCK")
                .font(OrionTheme.mono(15, .semibold))
                .tracking(6.5)
                .foregroundStyle(FocusPalette.warmWhite)
                .fixedSize()
            FocusFadingRule(reversed: true)
        }
        .frame(width: width)
    }

    // MARK: - Music

    private var musicSurface: some View {
        Group {
            if !isPreview, model.shouldOfferAudioChoices {
                audioChoiceSurface
            } else {
                nowPlayingSurface
            }
        }
    }

    private var audioChoiceSurface: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                VStack(alignment: .leading, spacing: 5) {
                    Text("FOCUS AUDIO")
                        .font(OrionTheme.mono(10, .semibold))
                        .tracking(2.8)
                        .foregroundStyle(FocusPalette.cyan)
                    Text("Nothing is playing")
                        .font(.system(size: 22, weight: .light))
                        .foregroundStyle(FocusPalette.warmWhite)
                }
                Spacer()
                if !isPreview { playlistPicker }
            }

            Text("Choose what should carry this block. Orion starts only the source you select.")
                .font(.system(size: 13, weight: .light))
                .foregroundStyle(OrionTheme.textDim)
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 10) {
                audioChoice(.appleMusic, detail: "Use your current queue in Music")
                audioChoice(.binaural, detail: "Local looping focus bed")
            }

            if let problem = model.mediaProblem {
                Text(problem)
                    .font(.system(size: 11, weight: .light))
                    .foregroundStyle(FocusPalette.orange.opacity(0.88))
                    .lineLimit(2)
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 22)
        .background(playerBackground)
    }

    private func audioChoice(_ source: SessionAudioSource, detail: String) -> some View {
        Button {
            model.activateAudioSource(source)
        } label: {
            HStack(spacing: 14) {
                Image(systemName: source.icon)
                    .font(.system(size: 19, weight: .medium))
                    .foregroundStyle(source == .appleMusic ? FocusPalette.gold : FocusPalette.cyan)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(Color.white.opacity(0.045)))
                VStack(alignment: .leading, spacing: 3) {
                    Text(source.title)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(FocusPalette.warmWhite)
                    Text(detail)
                        .font(.system(size: 11, weight: .light))
                        .foregroundStyle(OrionTheme.textDim)
                }
                Spacer()
                Image(systemName: "play.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(source == .appleMusic ? FocusPalette.gold : FocusPalette.cyan)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill((source == .appleMusic ? FocusPalette.gold : FocusPalette.cyan).opacity(0.11)))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(LinearGradient(colors: [Color.white.opacity(0.065), Color.white.opacity(0.025)],
                                         startPoint: .topLeading, endPoint: .bottomTrailing))
            }
            .overlay(alignment: .leading) {
                Capsule()
                    .fill((source == .appleMusic ? FocusPalette.gold : FocusPalette.cyan).opacity(0.72))
                    .frame(width: 2)
                    .padding(.vertical, 10)
            }
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.white.opacity(0.085), lineWidth: 0.7))
        }
        .buttonStyle(.plain)
    }

    private var nowPlayingSurface: some View {
        GeometryReader { proxy in
            let artwork = min(155, proxy.size.height * 0.42)

            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    if isPreview {
                        HStack(spacing: 6) {
                            Image(systemName: "music.note")
                            Text("APPLE MUSIC")
                        }
                        .font(OrionTheme.mono(8, .semibold))
                        .tracking(1.1)
                        .foregroundStyle(FocusPalette.cyan.opacity(0.86))
                    } else {
                        audioSourceMenu
                    }
                    Spacer()
                    if !isPreview { playlistPicker }
                    mediaStateBadge(isPreview ? "PLAYING" : model.mediaStateLabel)
                }
                .padding(.bottom, 14)

                HStack(alignment: .center, spacing: 28) {
                    Button {
                        if !isPreview { model.openAudioLocation() }
                    } label: {
                        sessionArtwork
                            .frame(width: artwork, height: artwork)
                            .overlay(alignment: .bottomTrailing) {
                                if !isPreview {
                                    Image(systemName: model.audioSource.icon)
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(FocusPalette.warmWhite)
                                        .padding(8)
                                        .background(Circle().fill(Color.black.opacity(0.72)))
                                        .padding(8)
                                }
                            }
                    }
                    .buttonStyle(.plain)
                    .help(model.audioSource == .appleMusic ? "Open Music" : "Open the binaural clip folder")

                    VStack(alignment: .leading, spacing: 7) {
                        Text(isPreview ? "Weightless" : model.mediaTitle)
                            .font(.system(size: 21, weight: .regular))
                            .foregroundStyle(FocusPalette.warmWhite)
                            .lineLimit(2)
                            .minimumScaleFactor(0.82)
                            .fixedSize(horizontal: false, vertical: true)

                        Text(isPreview ? "Marconi Union" : model.mediaArtist)
                            .font(.system(size: 15, weight: .light))
                            .foregroundStyle(OrionTheme.textSoft)
                            .lineLimit(1)
                        Text(isPreview ? "Ambient Works" : model.mediaAlbum)
                            .font(.system(size: 13, weight: .light))
                            .foregroundStyle(model.mediaProblem == nil ? OrionTheme.textDim : FocusPalette.orange.opacity(0.9))
                            .lineLimit(2)
                    }
                    Spacer(minLength: 0)
                }

                Spacer(minLength: 12)

                VStack(spacing: 6) {
                    FocusMediaSlider(
                        value: Binding(
                            get: { isPreview ? 0.39 : model.mediaProgress },
                            set: { if !isPreview { model.mediaSeek(fraction: $0) } }
                        ),
                        colors: [FocusPalette.gold, FocusPalette.warmWhite],
                        enabled: isPreview || model.mediaDuration > 0,
                        lineHeight: 2,
                        knobSize: 10
                    )
                    .frame(height: 10)

                    HStack {
                        Text(isPreview ? "2:18" : mediaClock(model.mediaPosition))
                        Spacer()
                        Text(isPreview ? "−4:35" : remainingMediaClock)
                    }
                    .font(OrionTheme.mono(9))
                    .foregroundStyle(OrionTheme.textDim)
                }

                Spacer(minLength: 10)

                HStack {
                    mediaButton("shuffle", active: !isPreview && model.mediaShuffleEnabled,
                                help: "Shuffle", action: model.mediaToggleShuffle)
                    Spacer()
                    mediaButton("backward.fill", help: "Previous", action: model.mediaPrevious)
                    Spacer()
                    Button {
                        if !isPreview { model.mediaPlayPause() }
                    } label: {
                        ZStack {
                            Circle()
                                .fill(LinearGradient(
                                    colors: [FocusPalette.gold.opacity(0.24), Color.white.opacity(0.07)],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                ))
                                .overlay(Circle().strokeBorder(FocusPalette.gold.opacity(0.48), lineWidth: 1))
                                .frame(width: 57, height: 57)
                                .shadow(color: FocusPalette.gold.opacity(0.16), radius: 10, y: 4)
                            Image(systemName: isPreview || model.mediaIsPlaying ? "pause.fill" : "play.fill")
                                .font(.system(size: 23, weight: .medium))
                                .offset(x: (!isPreview && !model.mediaIsPlaying) ? 1.5 : 0)
                        }
                    }
                    .buttonStyle(.plain)
                    .help(model.mediaIsPlaying ? "Pause" : "Play")
                    Spacer()
                    mediaButton("forward.fill", help: "Next", action: model.mediaNext)
                    Spacer()
                    mediaButton(model.mediaRepeatMode == "one" ? "repeat.1" : "repeat",
                                active: isPreview || model.mediaRepeatMode != "off",
                                help: model.audioSource == .binaural ? "Binaural tracks loop to the phase boundary" : "Repeat",
                                action: model.mediaCycleRepeat)
                }
                .font(.system(size: 19, weight: .medium))
                .foregroundStyle(FocusPalette.warmWhite.opacity(0.90))

                Spacer(minLength: 10)

                HStack(spacing: 13) {
                    Image(systemName: "speaker.fill")
                        .font(.system(size: 12))
                    FocusMediaSlider(
                        value: Binding(
                            get: { isPreview ? 0.68 : model.mediaVolume },
                            set: { if !isPreview { model.setMediaVolume($0) } }
                        ),
                        colors: [FocusPalette.cyan.opacity(0.80)],
                        enabled: true,
                        lineHeight: 3,
                        knobSize: 12
                    )
                    .frame(height: 14)
                    Image(systemName: "speaker.wave.3.fill")
                        .font(.system(size: 13))
                }
                .foregroundStyle(OrionTheme.textDim)
            }
            .padding(.horizontal, 26)
            .padding(.vertical, 24)
            .background(playerBackground)
        }
    }

    private var audioSourceMenu: some View {
        Menu {
            ForEach(SessionAudioSource.playableCases) { source in
                Button {
                    model.activateAudioSource(source)
                } label: {
                    Label(source.title, systemImage: source.icon)
                }
            }
            Divider()
            Button {
                model.openAudioLocation()
            } label: {
                Label(model.audioSource == .appleMusic ? "Open Music" : "Open clip folder",
                      systemImage: "arrow.up.forward.app")
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: model.audioSource.icon)
                Text(model.audioSource.title.uppercased())
                Image(systemName: "chevron.down")
                    .font(.system(size: 7, weight: .bold))
            }
            .font(OrionTheme.mono(8, .semibold))
            .tracking(1.1)
            .foregroundStyle(FocusPalette.cyan.opacity(0.86))
            .padding(.vertical, 5)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(FocusPalette.cyan.opacity(0.28))
                    .frame(height: 1)
            }
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
    }

    private func mediaStateBadge(_ label: String) -> some View {
        HStack(spacing: 6) {
            Circle()
                .fill(label == "PLAYING" ? FocusPalette.cyan : OrionTheme.textDim)
                .frame(width: 5, height: 5)
            Text(label)
        }
        .font(OrionTheme.mono(7, .semibold))
        .tracking(1.2)
        .foregroundStyle(label == "PLAYING" ? FocusPalette.cyan : OrionTheme.textDim)
        .padding(.vertical, 5)
    }

    private var playerBackground: some View {
        RoundedRectangle(cornerRadius: 16, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [Color.white.opacity(0.072), Color.white.opacity(0.024)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.11), lineWidth: 0.75)
            }
            .overlay(alignment: .leading) {
                Capsule()
                    .fill(LinearGradient(colors: [FocusPalette.cyan.opacity(0.82), .clear],
                                         startPoint: .top, endPoint: .bottom))
                    .frame(width: 2)
                    .padding(.vertical, 20)
            }
            .shadow(color: .black.opacity(0.20), radius: 14, y: 7)
    }

    private func mediaButton(_ icon: String, active: Bool = false, help: String,
                             action: @escaping () -> Void) -> some View {
        FocusTransportButton(icon: icon,
                             tint: active ? FocusPalette.gold : FocusPalette.warmWhite,
                             help: help) {
            if !isPreview { action() }
        }
    }

    private var remainingMediaClock: String {
        guard model.mediaDuration > 0 else { return "—:—" }
        return "−" + mediaClock(max(0, model.mediaDuration - model.mediaPosition))
    }

    @ViewBuilder
    private var sessionArtwork: some View {
        if isPreview || model.audioSource == .binaural {
            BinauralFocusArtwork()
        } else if model.audioSource == .appleMusic, let artwork = model.mediaArtwork {
            Image(nsImage: artwork)
                .resizable()
                .scaledToFill()
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.15), lineWidth: 0.7)
                }
        } else {
            AppleMusicArtworkPlaceholder()
        }
    }

    private func mediaClock(_ seconds: TimeInterval) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "—:—" }
        let total = Int(seconds.rounded(.down))
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    // MARK: - Timing and guard

    private var timingMetrics: some View {
        HStack(spacing: 48) {
            metric(value: elapsedClock(displayElapsed), label: "ELAPSED", tint: FocusPalette.cyan.opacity(0.65))
            Rectangle()
                .fill(FocusPalette.cyan.opacity(0.25))
                .frame(width: 1, height: 50)
            metric(value: nextBreakClock, label: "NEXT BREAK", tint: FocusPalette.gold)
        }
    }

    private var focusGuard: some View {
        VStack(spacing: 13) {
            HStack(spacing: 10) {
                Button {
                    if !isPreview, model.canRelease { model.release() }
                } label: {
                    Image(systemName: model.canRelease ? "shield.fill" : "shield")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(model.canRelease ? FocusPalette.cyan : OrionTheme.textDim)
                }
                .buttonStyle(.plain)
                .help(model.canRelease ? "Release Focus Guard" : "Focus Guard is not configured")

                Text("FOCUS GUARD")
                    .font(OrionTheme.mono(10, .semibold))
                    .tracking(3.2)
                    .foregroundStyle(FocusPalette.cyan.opacity(0.84))

                Text(isPreview ? "PROGRESSIVE · FIRM" : (model.activeGuardLabel ?? "NOT CONFIGURED"))
                    .font(OrionTheme.mono(8, .semibold))
                    .tracking(1.2)
                    .foregroundStyle(model.activeGuardMode == nil ? FocusPalette.orange : FocusPalette.warmWhite)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(Color.white.opacity(0.045)))

                Spacer()

                if !isPreview, model.driftCorrectionCount > 0 {
                    Text("\(model.driftCorrectionCount) REDIRECT\(model.driftCorrectionCount == 1 ? "" : "S")")
                        .font(OrionTheme.mono(8, .medium))
                        .foregroundStyle(OrionTheme.textDim)
                } else if !isPreview, model.activeGuardMode == nil {
                    Button("CHOOSE APPS") {
                        pendingGuard = GuardProposal(mode: .progressive, apps: model.guardProposal())
                    }
                    .buttonStyle(.plain)
                    .font(OrionTheme.mono(8, .semibold))
                    .tracking(1.2)
                    .foregroundStyle(FocusPalette.cyan)
                }
            }

            guardStrengthBar

            HStack(spacing: 7) {
                guardLabel(.progressive, tint: FocusPalette.warmWhite)
                guardLabel(.gentle, tint: FocusPalette.cyan)
                guardLabel(.guided, tint: FocusPalette.cyan)
                guardLabel(.firm, tint: FocusPalette.gold)
                guardLabel(.shield, tint: FocusPalette.orange)
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .background {
            RoundedRectangle(cornerRadius: 15, style: .continuous)
                .fill(Color.black.opacity(0.20))
                .overlay {
                    RoundedRectangle(cornerRadius: 15, style: .continuous)
                        .strokeBorder(FocusPalette.cyan.opacity(0.22), lineWidth: 0.8)
                }
        }
    }

    private var guardStrengthBar: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let progress = displayGuardStrength
            let knob = min(max(0, width * progress), width)

            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.white.opacity(0.07))
                    .frame(height: 4)

                Capsule()
                    .fill(LinearGradient(
                        colors: [FocusPalette.cyan, FocusPalette.cyan,
                                 FocusPalette.gold, FocusPalette.orange],
                        startPoint: .leading,
                        endPoint: .trailing
                    ))
                    .frame(width: max(5, knob), height: 4)
                    .shadow(color: FocusPalette.gold.opacity(0.22), radius: 5)

                HStack {
                    ForEach(0..<17, id: \.self) { _ in
                        Rectangle()
                            .fill(Color.white.opacity(0.14))
                            .frame(width: 1, height: 7)
                        Spacer(minLength: 0)
                    }
                }

                Circle()
                    .fill(FocusPalette.warmWhite)
                    .frame(width: 10, height: 10)
                    .offset(x: max(0, min(width - 10, knob - 5)))
                    .shadow(color: FocusPalette.gold.opacity(0.8), radius: 6)
            }
            .frame(maxHeight: .infinity)
        }
        .frame(height: 12)
        .accessibilityLabel("Focus Guard strength")
        .accessibilityValue("\(Int(displayGuardStrength * 100)) percent")
    }

    private func guardLabel(_ mode: SessionGuardMode, tint: Color) -> some View {
        let isActive = isPreview ? mode == .progressive : model.activeGuardMode == mode
        return Button {
            guard !isPreview else { return }
            pendingGuard = GuardProposal(mode: mode, apps: model.guardProposal())
        } label: {
            Text(mode.title)
                .font(OrionTheme.mono(9, .medium))
                .tracking(mode == .progressive ? 1.0 : 1.5)
                .foregroundStyle(tint.opacity(isActive ? 1 : 0.64))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(isActive ? tint.opacity(0.07) : Color.clear)
                }
                .overlay(alignment: .bottom) {
                    Rectangle()
                        .fill(isActive ? tint.opacity(0.82) : Color.white.opacity(0.08))
                        .frame(height: isActive ? 2 : 1)
                }
        }
        .buttonStyle(.plain)
        .help(mode.explanation)
    }

    private func metric(value: String, label: String, tint: Color) -> some View {
        VStack(spacing: 7) {
            Text(value)
                .font(.system(size: 19, weight: .light, design: .monospaced))
                .monospacedDigit()
                .foregroundStyle(FocusPalette.warmWhite)
            Text(label)
                .font(OrionTheme.mono(9, .medium))
                .tracking(3.0)
                .foregroundStyle(tint)
        }
    }

    private func presentProactiveGuardIfNeeded() {
        // 2026-10-16 UI audit #2: a request that has been cleared (the session
        // ended or was abandoned) closes the sheet; and never present one for a
        // session that is not live.
        guard let request = model.guardSetupRequest, model.hasLiveSession else {
            if pendingGuard != nil { pendingGuard = nil }
            return
        }
        guard !isPreview, pendingGuard == nil else { return }
        pendingGuard = GuardProposal(mode: request.mode, apps: request.apps)
    }

    // MARK: - Display values

    private var displayDialProgress: Double {
        isPreview ? 0.42 : min(1, max(0.012, model.phaseProgress))
    }

    private var displayRemaining: TimeInterval {
        isPreview ? 42 * 60 + 18 : model.phaseRemainingSeconds
    }

    private var displayElapsed: TimeInterval {
        isPreview ? 7 * 60 + 42 : model.focusElapsedSeconds
    }

    private var displayGuardStrength: Double {
        isPreview ? 0.67 : min(1, max(0.02, model.guardStrength))
    }

    private var nextBreakClock: String {
        if isPreview { return "9:40 PM" }
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: Date().addingTimeInterval(displayRemaining))
    }

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 5..<12: return "Good morning."
        case 12..<17: return "Good afternoon."
        default: return "Good evening."
        }
    }

    private var background: some View {
        ZStack {
            Color(red: 0.008, green: 0.018, blue: 0.030)
            RadialGradient(
                colors: [FocusPalette.cyan.opacity(0.07), .clear],
                center: UnitPoint(x: 0.67, y: 0.40),
                startRadius: 10,
                endRadius: 620
            )
            RadialGradient(
                colors: [FocusPalette.gold.opacity(0.035), .clear],
                center: UnitPoint(x: 0.24, y: 0.30),
                startRadius: 10,
                endRadius: 430
            )
            LinearGradient(
                colors: [Color.clear, Color.black.opacity(0.32)],
                startPoint: .top,
                endPoint: .bottom
            )
        }
    }

    private func clock(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds.rounded(.down)))
        return String(format: "%02d:%02d", total / 60, total % 60)
    }

    private func elapsedClock(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds.rounded(.down)))
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}

// MARK: - Dial

struct FocusTimerDial: View {
    let diameter: CGFloat
    let progress: Double
    let remaining: String
    let phase: String

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.white.opacity(0.06), lineWidth: 2)

            ForEach(0..<4, id: \.self) { quarter in
                Circle()
                    .trim(from: 0.018, to: 0.232)
                    .stroke(FocusPalette.cyan.opacity(quarter == 0 ? 0.32 : 0.13),
                            style: StrokeStyle(lineWidth: quarter == 0 ? 3 : 1.4, lineCap: .butt))
                    .rotationEffect(.degrees(Double(quarter) * 90 - 90))
                    .padding(12)
            }

            Circle()
                .trim(from: 0, to: progress)
                .stroke(
                    AngularGradient(
                        colors: [FocusPalette.cyan, FocusPalette.brightGold, FocusPalette.gold],
                        center: .center
                    ),
                    style: StrokeStyle(lineWidth: 6, lineCap: .square)
                )
                .rotationEffect(.degrees(-90))
                .padding(22)
                .shadow(color: FocusPalette.cyan.opacity(0.34), radius: 8)

            Circle()
                .stroke(FocusPalette.cyan.opacity(0.18), lineWidth: 1)
                .padding(44)

            Circle()
                .fill(
                    RadialGradient(colors: [FocusPalette.cyan.opacity(0.055), .clear],
                                   center: .center, startRadius: 0, endRadius: diameter * 0.40)
                )
                .padding(45)

            Circle()
                .fill(FocusPalette.cyan)
                .frame(width: 9, height: 9)
                .shadow(color: FocusPalette.cyan.opacity(0.85), radius: 8)
                .offset(y: -(diameter / 2 - 22))
                .rotationEffect(.degrees(progress * 360))

            VStack(spacing: diameter * 0.035) {
                Text(phase)
                    .font(OrionTheme.mono(max(8, diameter * 0.017), .semibold))
                    .tracking(diameter * 0.007)
                    .foregroundStyle(FocusPalette.cyan.opacity(0.78))
                    .lineLimit(1)

                Text(remaining)
                    .font(.system(size: diameter * 0.205, weight: .ultraLight, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(FocusPalette.warmWhite)
                    .contentTransition(.numericText())

                HStack(spacing: 9) {
                    Rectangle().fill(FocusPalette.gold).frame(width: 18, height: 1)
                    Text("REMAINING")
                    Rectangle().fill(FocusPalette.gold).frame(width: 18, height: 1)
                }
                    .font(OrionTheme.mono(max(10, diameter * 0.021), .medium))
                    .tracking(diameter * 0.009)
                    .foregroundStyle(FocusPalette.warmWhite.opacity(0.72))
            }
        }
        .frame(width: diameter, height: diameter)
    }
}

// MARK: - Orion constellation

private struct SessionConstellation: View {
    let model: HologramModel

    var body: some View {
        ZStack {
            SessionOrbitField()
            HologramView(model: model)
                .padding(18)
        }
        .allowsHitTesting(false)
    }
}

private struct SessionOrbitField: View {
    var body: some View {
        Canvas { context, size in
            let inset = min(size.width, size.height) * 0.08
            let field = CGRect(x: inset, y: inset, width: size.width - inset * 2, height: size.height - inset * 2)
            context.stroke(Path(roundedRect: field, cornerRadius: 22),
                           with: .color(FocusPalette.cyan.opacity(0.14)), lineWidth: 0.8)

            for step in 1..<6 {
                let x = field.minX + field.width * CGFloat(step) / 6
                var line = Path()
                line.move(to: CGPoint(x: x, y: field.minY))
                line.addLine(to: CGPoint(x: x, y: field.maxY))
                context.stroke(line, with: .color(FocusPalette.cyan.opacity(0.035)), lineWidth: 0.6)
            }

            var signal = Path()
            let midY = field.midY
            signal.move(to: CGPoint(x: field.minX, y: midY))
            for step in 0...80 {
                let t = CGFloat(step) / 80
                let amplitude = sin(t * .pi) * field.height * 0.11
                let wave = sin(t * .pi * 11) * amplitude
                signal.addLine(to: CGPoint(x: field.minX + field.width * t, y: midY + wave))
            }
            context.stroke(signal, with: .color(FocusPalette.cyan.opacity(0.18)), lineWidth: 0.8)

            let corner: CGFloat = 22
            for origin in [field.origin,
                           CGPoint(x: field.maxX - corner, y: field.minY),
                           CGPoint(x: field.minX, y: field.maxY - corner),
                           CGPoint(x: field.maxX - corner, y: field.maxY - corner)] {
                context.fill(Path(CGRect(x: origin.x, y: origin.y, width: corner, height: 1)),
                             with: .color(FocusPalette.cyan.opacity(0.56)))
            }
        }
    }
}

// MARK: - Album artwork

private struct BinauralFocusArtwork: View {
    var body: some View {
        Canvas { context, size in
            for index in 0..<34 {
                var path = Path()
                let phase = Double(index) * 0.19
                let lane = (Double(index) - 16.5) * 1.7
                for step in 0...90 {
                    let t = Double(step) / 90
                    let x = CGFloat(t) * (size.width + 28) - 14
                    let crest = sin(t * Double.pi * 2.15 + phase) * 17
                    let crossing = sin(t * Double.pi * 0.92 + 0.7) * 30
                    let y = size.height * 0.56 + CGFloat(crest + crossing + lane)
                    let point = CGPoint(x: x, y: y)
                    if step == 0 { path.move(to: point) } else { path.addLine(to: point) }
                }
                let warm = index < 18
                let color = warm ? FocusPalette.gold : FocusPalette.cyan
                context.stroke(path, with: .color(color.opacity(warm ? 0.42 : 0.26)), lineWidth: index.isMultiple(of: 7) ? 1.1 : 0.45)
            }
        }
        .background {
            ZStack {
                LinearGradient(
                    colors: [Color(red: 0.015, green: 0.035, blue: 0.055), Color.black],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                RadialGradient(colors: [FocusPalette.gold.opacity(0.22), .clear], center: .leading, startRadius: 5, endRadius: 120)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Color.white.opacity(0.15), lineWidth: 0.7)
        }
    }
}

private struct AppleMusicArtworkPlaceholder: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [FocusPalette.gold.opacity(0.20), Color.white.opacity(0.035), Color.black.opacity(0.24)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Circle()
                .fill(FocusPalette.gold.opacity(0.10))
                .frame(width: 86, height: 86)
                .blur(radius: 7)
            Image(systemName: "music.note")
                .font(.system(size: 40, weight: .light))
                .foregroundStyle(FocusPalette.gold.opacity(0.88))
        }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Color.white.opacity(0.14), lineWidth: 0.7)
        }
    }
}

private struct FocusTransportButton: View {
    let icon: String
    let tint: Color
    let help: String
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(hovering ? tint : tint.opacity(0.72))
                .frame(width: 36, height: 36)
                .background(Circle().fill(Color.white.opacity(hovering ? 0.085 : 0.025)))
                .overlay(Circle().strokeBorder(tint.opacity(hovering ? 0.28 : 0.08), lineWidth: 0.8))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .help(help)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.14), value: hovering)
    }
}

/// A thin, visual slider that keeps the reference's instrument-panel styling
/// while behaving like a normal seek or source-volume control.
private struct FocusMediaSlider: View {
    @Binding var value: Double
    let colors: [Color]
    let enabled: Bool
    let lineHeight: CGFloat
    let knobSize: CGFloat

    var body: some View {
        GeometryReader { proxy in
            let fraction = min(1, max(0, value))
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.12)).frame(height: lineHeight)
                Capsule()
                    .fill(LinearGradient(colors: colors, startPoint: .leading, endPoint: .trailing))
                    .frame(width: proxy.size.width * fraction, height: lineHeight)
                Circle()
                    .fill(FocusPalette.warmWhite)
                    .frame(width: knobSize, height: knobSize)
                    .offset(x: max(0, min(proxy.size.width - knobSize,
                                          proxy.size.width * fraction - knobSize / 2)))
                    .shadow(color: colors.first?.opacity(0.45) ?? .clear, radius: 4)
            }
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { drag in
                        guard enabled, proxy.size.width > 0 else { return }
                        value = min(1, max(0, drag.location.x / proxy.size.width))
                    }
            )
            .opacity(enabled ? 1 : 0.42)
        }
    }
}

private struct GuardProposal: Identifiable {
    let id = UUID()
    let mode: SessionGuardMode
    let apps: [ProposedApp]
}

private struct GuardSetupSheet: View {
    let proposal: GuardProposal
    let onArm: (SessionGuardMode, Set<String>) -> Void
    let onCancel: () -> Void
    @State private var allowed = Set<String>()
    @State private var selectedMode: SessionGuardMode

    init(proposal: GuardProposal,
         onArm: @escaping (SessionGuardMode, Set<String>) -> Void,
         onCancel: @escaping () -> Void) {
        self.proposal = proposal
        self.onArm = onArm
        self.onCancel = onCancel
        _selectedMode = State(initialValue: proposal.mode)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(spacing: 12) {
                Image(systemName: "shield.lefthalf.filled")
                    .font(.system(size: 25, weight: .light))
                    .foregroundStyle(FocusPalette.cyan)
                VStack(alignment: .leading, spacing: 4) {
                    Text("WHICH APPS CAN YOU USE?")
                        .font(OrionTheme.mono(13, .semibold))
                        .tracking(3)
                        .foregroundStyle(FocusPalette.cyan)
                    Text("Orion needs your answer before guarding this block.")
                        .font(.system(size: 13, weight: .light))
                        .foregroundStyle(OrionTheme.textSoft)
                }
            }

            Text("Choose the apps that belong to this focus block. Orion never guesses this list. Finder, Orion, login, and your password manager always remain available.")
                .font(.system(size: 13, weight: .light))
                .foregroundStyle(OrionTheme.textDim)
                .fixedSize(horizontal: false, vertical: true)

            // 2026-10-16 UI audit #7: text tabs of natural width with a cyan
            // underline for the choice, instead of five equal filled tiles.
            HStack(alignment: .firstTextBaseline, spacing: 20) {
                ForEach(SessionGuardMode.allCases) { mode in
                    Button(mode.title) { selectedMode = mode }
                        .buttonStyle(.plain)
                        .font(OrionTheme.mono(8, .semibold))
                        .tracking(1.1)
                        .foregroundStyle(selectedMode == mode ? FocusPalette.cyan : OrionTheme.textSoft)
                        .padding(.bottom, 5)
                        .overlay(alignment: .bottom) {
                            Rectangle().fill(selectedMode == mode ? FocusPalette.cyan.opacity(0.7) : Color.clear)
                                .frame(height: 0.7)
                        }
                }
            }

            Text(selectedMode.explanation)
                .font(.system(size: 11, weight: .light))
                .foregroundStyle(OrionTheme.textDim)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(proposal.apps, id: \.bundleID) { app in
                        Toggle(isOn: Binding(
                            get: { allowed.contains(app.bundleID) },
                            set: { checked in
                                if checked { allowed.insert(app.bundleID) }
                                else { allowed.remove(app.bundleID) }
                            }
                        )) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(app.name)
                                    .foregroundStyle(OrionTheme.text)
                                Text(app.bundleID)
                                    .font(OrionTheme.mono(9))
                                    .foregroundStyle(OrionTheme.textDim)
                            }
                        }
                        .toggleStyle(.checkbox)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 9)
                        .overlay(alignment: .bottom) { FadingHairline() }
                    }
                }
            }
            .frame(minHeight: 190, maxHeight: .infinity)

            HStack {
                Text(allowed.isEmpty ? "Select at least one work app." : "\(allowed.count) work app\(allowed.count == 1 ? "" : "s") allowed")
                    .font(OrionTheme.mono(9))
                    .foregroundStyle(allowed.isEmpty ? FocusPalette.orange : FocusPalette.cyan)
                Spacer()
                Button("Cancel", action: onCancel)
                    .buttonStyle(.plain)
                    .foregroundStyle(OrionTheme.textSoft)
                Button("ARM GUARD") {
                    onArm(selectedMode, allowed)
                }
                .buttonStyle(OutlineButtonStyle(tint: FocusPalette.cyan))
                .disabled(allowed.isEmpty)
            }
        }
        .padding(26)
        .frame(width: 540, height: 570)
        .background(Color(red: 0.015, green: 0.030, blue: 0.048))
    }
}

private struct FocusFadingRule: View {
    var reversed = false

    var body: some View {
        LinearGradient(
            colors: reversed
                ? [.clear, FocusPalette.cyan.opacity(0.52)]
                : [FocusPalette.cyan.opacity(0.52), .clear],
            startPoint: .leading,
            endPoint: .trailing
        )
        .frame(height: 1)
        .overlay(alignment: reversed ? .trailing : .leading) {
            Circle()
                .fill(FocusPalette.cyan)
                .frame(width: 5, height: 5)
                .shadow(color: FocusPalette.cyan.opacity(0.8), radius: 5)
        }
    }
}

private struct FourPointStar: Shape {
    func path(in rect: CGRect) -> Path {
        let cx = rect.midX
        let cy = rect.midY
        var path = Path()
        path.move(to: CGPoint(x: cx, y: rect.minY))
        path.addLine(to: CGPoint(x: cx + rect.width * 0.10, y: cy - rect.height * 0.10))
        path.addLine(to: CGPoint(x: rect.maxX, y: cy))
        path.addLine(to: CGPoint(x: cx + rect.width * 0.10, y: cy + rect.height * 0.10))
        path.addLine(to: CGPoint(x: cx, y: rect.maxY))
        path.addLine(to: CGPoint(x: cx - rect.width * 0.10, y: cy + rect.height * 0.10))
        path.addLine(to: CGPoint(x: rect.minX, y: cy))
        path.addLine(to: CGPoint(x: cx - rect.width * 0.10, y: cy - rect.height * 0.10))
        path.closeSubpath()
        return path
    }
}

private enum FocusPalette {
    static let cyan = Color(red: 0.30, green: 0.82, blue: 1.00)
    static let warmWhite = Color(red: 0.91, green: 0.89, blue: 0.83)
    static let brightGold = Color(red: 1.00, green: 0.91, blue: 0.43)
    static let gold = Color(red: 1.00, green: 0.74, blue: 0.27)
    static let orange = Color(red: 1.00, green: 0.48, blue: 0.09)
}


/// The rest of today beside the timer: what is on now and what is next
/// (calendar, read directly; 2026-10-06 "maybe it should include the schedule").
private struct SessionDayStrip: View {
    @State private var items: [(title: String, start: Date, end: Date)] = []
    // RefreshTicker, not Timer.publish: a child timer here never fires (see RefreshTicker).
    @StateObject private var clock = RefreshTicker(interval: 60)

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("REST OF TODAY").font(OrionTheme.mono(9, .semibold)).tracking(2.4).foregroundStyle(FocusPalette.cyan)
            if items.isEmpty {
                Text("Nothing else on the calendar today").font(.system(size: 12, weight: .light)).foregroundStyle(OrionTheme.textDim)
            }
            ForEach(Array(items.prefix(4).enumerated()), id: \.offset) { _, item in
                let now = Date()
                let current = item.start <= now && item.end > now
                HStack(spacing: 10) {
                    Circle().fill(current ? FocusPalette.cyan : Color.white.opacity(0.25)).frame(width: 5, height: 5)
                    Text(item.start.formatted(date: .omitted, time: .shortened))
                        .font(OrionTheme.mono(10, .medium)).foregroundStyle(OrionTheme.textDim).frame(width: 64, alignment: .leading)
                    Text(item.title).font(.system(size: 12, weight: current ? .medium : .light))
                        .foregroundStyle(current ? FocusPalette.warmWhite : OrionTheme.textSoft).lineLimit(1)
                }
            }
        }
        .onAppear(perform: load)
        .onChange(of: clock.tick) { _, _ in load() }
    }

    private func load() {
        let store = EKEventStore()
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else { return }
        let now = Date()
        let end = Calendar.current.date(bySettingHour: 23, minute: 59, second: 0, of: now) ?? now
        let events = store.events(matching: store.predicateForEvents(withStart: now, end: end, calendars: nil))
            .filter { !$0.isAllDay }
            .sorted { $0.startDate < $1.startDate }
        items = events.map { (title: $0.title ?? "Untitled", start: $0.startDate, end: $0.endDate) }
    }
}

/// The session, tucked away: a floating bar over the rest of ORION with the
/// hologram, the block and the time left, pause, and the way back in (2026-10-06).
struct SessionMiniBar: View {
    let hologram: HologramModel
    @ObservedObject var model: SessionTabModel
    let onExpand: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            HologramView(model: hologram)
                .frame(width: 34, height: 34)
                .clipShape(Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(model.focusBlockLabel.uppercased())
                    .font(OrionTheme.mono(8, .semibold)).tracking(1.6).foregroundStyle(FocusPalette.cyan)
                Text(remaining).font(.system(size: 18, weight: .light, design: .rounded)).monospacedDigit()
                    .foregroundStyle(FocusPalette.warmWhite)
            }
            ProgressView(value: min(1, max(0, model.phaseProgress)))
                .progressViewStyle(.linear).tint(FocusPalette.cyan).frame(width: 90)
            Button { model.toggleSessionPause() } label: {
                Image(systemName: model.headline == "Paused" ? "play.fill" : "pause.fill").font(.system(size: 12, weight: .semibold))
                    .frame(width: 28, height: 28).overlay(Circle().strokeBorder(Color.white.opacity(0.2), lineWidth: 0.5))
            }
            .buttonStyle(.plain).foregroundStyle(FocusPalette.warmWhite)
            .help(model.headline == "Paused" ? "Resume" : "Pause")
            Button(action: onExpand) {
                Image(systemName: "arrow.up.left.and.arrow.down.right").font(.system(size: 12, weight: .semibold))
                    .frame(width: 28, height: 28).overlay(Circle().strokeBorder(FocusPalette.cyan.opacity(0.5), lineWidth: 0.5))
            }
            .buttonStyle(.plain).foregroundStyle(FocusPalette.cyan)
            .help("Back to the focus session")
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        // 2026-10-16 UI audit #8: real alpha instead of .ultraThinMaterial.
        .background(Capsule().fill(Color.black.opacity(0.42)))
        .overlay(Capsule().strokeBorder(FocusPalette.cyan.opacity(0.28), lineWidth: 0.5))
        .shadow(color: FocusPalette.cyan.opacity(0.18), radius: 18)
    }

    private var remaining: String {
        let total = max(0, Int(model.phaseRemainingSeconds.rounded(.down)))
        return String(format: "%02d:%02d", total / 60, total % 60)
    }
}
