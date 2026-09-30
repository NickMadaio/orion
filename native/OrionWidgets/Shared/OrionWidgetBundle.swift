import SwiftUI
import WidgetKit

@main
struct OrionWidgetBundle: WidgetBundle {
    var body: some Widget {
        HologramWidget()
        HorizonWidget()
        CommandWidget()
        NowNextWidget()
        TodayWidget()
        TodoWidget()
        ProjectWidget()
        CheckinWidget()
        RingsWidget()
        TonightWidget()
        DeadlineWidget()
        #if os(iOS)
        OrionLiveActivity()
        if #available(iOS 26.0, *) { WakeAlarmActivity() }
        #endif
    }
}
