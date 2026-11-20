import HealthKit
import SwiftUI

@main
struct KovaHealthApp: App {
    var body: some Scene {
        WindowGroup {
            HealthView()
        }
    }
}

private struct HealthView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var store = HKHealthStore()
    @State private var report: StepReport?
    @State private var status: String?
    @State private var isReading = false
    @State private var hasExport = StepReportFile.exists
    @State private var isForeground = false

    var body: some View {
        NavigationStack {
            List {
                Section("Apple Health") {
                    Text("See daily steps for the last seven days. You can choose to save a copy on this iPhone for the KovaGPT website.")
                        .foregroundStyle(.secondary)
                    if HKHealthStore.isHealthDataAvailable() {
                        Button("Read step totals") {
                            Task { await readSteps() }
                        }
                        .disabled(isReading)
                    } else {
                        Text("Apple Health is unavailable on this device.")
                    }
                    if isReading {
                        ProgressView("Reading step totals")
                    }
                }

                if let report, !report.days.isEmpty {
                    Section("Daily steps") {
                        ForEach(report.days.reversed(), id: \.date) { day in
                            LabeledContent(day.date, value: day.steps.formatted())
                        }
                    }
                    Section("View on KovaGPT") {
                        Button("Save report on this iPhone", action: saveReport)
                        Text("In KovaGPT’s Health tab, tap Open Apple Health report. In Files, choose On My iPhone → KovaGPT Health → Reports.")
                            .foregroundStyle(.secondary)
                    }
                }

                if hasExport {
                    Section("Saved report") {
                        Link("Open KovaGPT Connections", destination: URL(string: "https://kovagpt.com/apps")!)
                        Button("Delete saved report", role: .destructive, action: deleteReport)
                    }
                }

                if let status {
                    Section {
                        Text(status).accessibilityAddTraits(.updatesFrequently)
                    }
                }
            }
            .navigationTitle("KovaGPT Health")
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            isForeground = phase == .active
            if phase == .background {
                report = nil
                status = nil
            }
        }
    }

    @MainActor
    private func readSteps() async {
        guard !isReading else { return }
        isReading = true
        report = nil
        status = nil
        defer { isReading = false }
        do {
            let result = try await StepReport.read(from: store)
            guard isForeground else { return }
            if result.days.isEmpty {
                status = "No step totals are available. Check the app’s read access in Apple Health and try again."
                return
            }
            report = result
        } catch {
            if isForeground {
                status = "Apple Health couldn’t read step totals. Try again while your device is unlocked."
            }
        }
    }

    private func saveReport() {
        guard let report else { return }
        do {
            try StepReportFile.write(report)
            hasExport = true
            status = "Report saved under On My iPhone. You can delete it here after opening it in KovaGPT."
        } catch {
            status = "The report couldn’t be saved. Try again."
        }
    }

    private func deleteReport() {
        do {
            try StepReportFile.remove()
            hasExport = false
            status = "Saved report deleted from this iPhone."
        } catch {
            status = "The saved report couldn’t be deleted. Try again."
        }
    }
}
