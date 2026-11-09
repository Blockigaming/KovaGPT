import ActivityKit
import WidgetKit
import SwiftUI

@available(iOS 16.1, *)
struct KovaVoiceActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: KovaVoiceActivityAttributes.self) { context in
            HStack(spacing: 14) {
                Image(systemName: "waveform.circle.fill")
                    .font(.largeTitle)
                    .foregroundStyle(.blue)
                VStack(alignment: .leading, spacing: 4) {
                    Text("KovaGPT Voice").font(.headline)
                    Text(context.state.label).font(.subheadline)
                }
                Spacer()
                Link("Return", destination: URL(string: "kovagpt://voice")!)
                    .font(.subheadline.weight(.semibold))
            }
            .padding(16)
            .activityBackgroundTint(Color(uiColor: .secondarySystemBackground))
            .activitySystemActionForegroundColor(.primary)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "waveform").foregroundStyle(.blue)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("KovaGPT").font(.headline)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text(context.state.label)
                        Spacer()
                        Link("Return to Voice", destination: URL(string: "kovagpt://voice")!)
                    }
                    .font(.subheadline)
                }
            } compactLeading: {
                Image(systemName: "waveform").foregroundStyle(.blue)
            } compactTrailing: {
                Text(context.state.phase == "recording" ? "Mic" : "Kova")
                    .font(.caption2)
            } minimal: {
                Image(systemName: "waveform").foregroundStyle(.blue)
            }
            .widgetURL(URL(string: "kovagpt://voice"))
            .keylineTint(.blue)
        }
    }
}
