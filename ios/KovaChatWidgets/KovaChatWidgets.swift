import SwiftUI
import WidgetKit

struct KovaWidgetEntry: TimelineEntry {
    let date: Date
}

struct KovaWidgetTimeline: TimelineProvider {
    func placeholder(in context: Context) -> KovaWidgetEntry { KovaWidgetEntry(date: .now) }
    func getSnapshot(in context: Context, completion: @escaping (KovaWidgetEntry) -> Void) {
        completion(placeholder(in: context))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<KovaWidgetEntry>) -> Void) {
        completion(Timeline(entries: [placeholder(in: context)], policy: .never))
    }
}

struct KovaWidgetView: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        Group {
            switch family {
            case .accessoryInline:
                Label("Kova Voice", systemImage: "waveform")
            case .accessoryCircular:
                ZStack {
                    AccessoryWidgetBackground()
                    Image(systemName: "waveform").accessibilityLabel("Open Kova Voice")
                }
            case .accessoryRectangular:
                Label("Kova Voice", systemImage: "waveform")
                    .frame(maxWidth: .infinity, alignment: .leading)
            default:
                VStack(alignment: .leading, spacing: 10) {
                    Link(destination: KovaDestination.chat.shortcutURL) {
                        Label("Chat", systemImage: "bubble.left")
                    }
                    Link(destination: KovaDestination.voice.shortcutURL) {
                        Label("Voice", systemImage: "waveform")
                    }
                    Link(destination: KovaDestination.images.shortcutURL) {
                        Label("Images", systemImage: "photo")
                    }
                }
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            }
        }
        .widgetURL(family == .systemMedium ? KovaDestination.chat.shortcutURL : KovaDestination.voice.shortcutURL)
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

@main
struct KovaChatWidgets: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "com.kovagpt.chat.shortcuts", provider: KovaWidgetTimeline()) { _ in
            KovaWidgetView()
        }
        .configurationDisplayName("KovaGPT Shortcuts")
        .description("Open chat, voice, or images without showing your conversations.")
        .supportedFamilies([.systemMedium, .accessoryCircular, .accessoryInline, .accessoryRectangular])
    }
}
