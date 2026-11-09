import WidgetKit
import SwiftUI

private struct ShortcutEntry: TimelineEntry {
    let date: Date
}

private struct ShortcutProvider: TimelineProvider {
    func placeholder(in context: Context) -> ShortcutEntry {
        ShortcutEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (ShortcutEntry) -> Void) {
        completion(ShortcutEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ShortcutEntry>) -> Void) {
        completion(Timeline(entries: [ShortcutEntry(date: Date())], policy: .never))
    }
}

private struct KovaShortcutsView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .foregroundStyle(.blue)
                Text("KovaGPT")
                    .font(.headline)
                    .lineLimit(1)
                Spacer()
            }
            HStack(spacing: 10) {
                shortcut("New chat", icon: "square.and.pencil", link: "kovagpt://new-chat")
                shortcut("Scan document", icon: "doc.viewfinder", link: "kovagpt://scan")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func shortcut(_ label: String, icon: String, link: String) -> some View {
        Link(destination: URL(string: link)!) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                Text(label)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.primary)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.primary.opacity(0.08))
            )
        }
        .accessibilityLabel(label + " in KovaGPT")
    }
}

private struct KovaShortcutsWidget: Widget {
    let kind = "KovaGPTShortcuts"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ShortcutProvider()) { _ in
            if #available(iOS 17.0, *) {
                KovaShortcutsView()
                    .containerBackground(for: .widget) {
                        Color(uiColor: .secondarySystemBackground)
                    }
            } else {
                KovaShortcutsView()
                    .background(Color(uiColor: .secondarySystemBackground))
            }
        }
        .configurationDisplayName("KovaGPT shortcuts")
        .description("Open a new chat or scan a document with a native shortcut.")
        .supportedFamilies([.systemMedium])
    }
}

@main
struct KovaWidgetBundle: WidgetBundle {
    var body: some Widget {
        KovaShortcutsWidget()
    }
}
