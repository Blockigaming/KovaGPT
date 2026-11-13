import HealthKit
import SwiftUI
import UIKit

@main
struct KovaHealthApp: App {
    var body: some Scene {
        WindowGroup { StepsView() }
    }
}

struct StepsView: View {
    @State private var store = HKHealthStore()
    @State private var total: Int?
    @State private var whoopSummary: String?
    @State private var loading = false
    @State private var message: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Kova Health").font(.largeTitle.bold())
            Text("Read today's step total from Apple Health. You choose whether to copy it.")
            Button("Read today's steps") {
                Task { await readSteps() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(loading)

            if let total {
                Text(total.formatted() + " steps").font(.title2)
                Link("Open KovaGPT Health", destination: URL(string: "https://kovagpt.com/apps?connection_view=health")!)
                Button("Copy step total") {
                    UIPasteboard.general.setItems(
                        [["public.utf8-plain-text": String(total)]],
                        options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(300)]
                    )
                    message = "Copied. Paste it in KovaGPT → Connections → Health."
                }
            }
            Button("Read WHOOP data from Apple Health") {
                Task { await readWhoop() }
            }
            .buttonStyle(.bordered)
            .disabled(loading)

            if let whoopSummary {
                Text(whoopSummary)
                Button("Copy WHOOP summary") {
                    UIPasteboard.general.setItems(
                        [["public.utf8-plain-text": whoopSummary]],
                        options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(300)]
                    )
                    message = "Copied. Paste into the WHOOP via Apple Health field in KovaGPT."
                }
                Link("Open KovaGPT Health", destination: URL(string: "https://kovagpt.com/apps?connection_view=health")!)
            }
            if let message {
                Text(message).foregroundStyle(.secondary)
            }
        }
        .padding(24)
    }

    @MainActor
    private func readWhoop() async {
        whoopSummary = nil
        message = nil
        guard HKHealthStore.isHealthDataAvailable(),
              let sleep = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis),
              let heart = HKQuantityType.quantityType(forIdentifier: .restingHeartRate) else {
            message = "Apple Health is unavailable on this device."
            return
        }
        loading = true
        defer { loading = false }
        do {
            try await store.requestAuthorization(toShare: [], read: [sleep, heart])
            let now = Date()
            let start = now.addingTimeInterval(-24 * 60 * 60)
            let recent = HKQuery.predicateForSamples(withStart: start, end: now)
            let sleepSamples = try await HKSampleQueryDescriptor(
                predicates: [.categorySample(type: sleep, predicate: recent)],
                sortDescriptors: [SortDescriptor(\.startDate)]
            ).result(for: store)
            let asleep: Set<Int> = [
                HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
                HKCategoryValueSleepAnalysis.asleepCore.rawValue,
                HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
                HKCategoryValueSleepAnalysis.asleepREM.rawValue,
            ]
            var seconds = 0.0
            var coveredUntil = start
            for sample in sleepSamples where sample.sourceRevision.source.bundleIdentifier.lowercased() == "com.whoop.iphone" && asleep.contains(sample.value) {
                let end = min(sample.endDate, now)
                let intervalStart = max(sample.startDate, coveredUntil)
                if end > intervalStart {
                    seconds += end.timeIntervalSince(intervalStart)
                    coveredUntil = end
                }
            }
            let heartSamples = try await HKSampleQueryDescriptor(
                predicates: [.quantitySample(type: heart, predicate: recent)],
                sortDescriptors: [SortDescriptor(\.endDate, order: .reverse)]
            ).result(for: store)
            let bpm = heartSamples.first {
                $0.sourceRevision.source.bundleIdentifier.lowercased() == "com.whoop.iphone"
            }?.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
            let minutes = Int(seconds / 60)
            let sleepText = minutes > 0 ? String(minutes) : "unavailable"
            let heartText = bpm.flatMap { $0.isFinite && (1...300).contains($0) ? String(Int($0.rounded())) : nil }
            guard minutes > 0 || heartText != nil else {
                message = "No recent WHOOP records are available. Check WHOOP's Apple Health sync and read permissions."
                return
            }
            whoopSummary = "WHOOP via Apple Health | Sleep (last 24 hours): \(sleepText) | Resting heart rate (bpm): \(heartText ?? "unavailable")"
        } catch {
            message = "Couldn't read WHOOP data from Apple Health. Check access and try again."
        }
    }

    @MainActor
    private func readSteps() async {
        total = nil
        message = nil
        guard HKHealthStore.isHealthDataAvailable(),
              let steps = HKQuantityType.quantityType(forIdentifier: .stepCount) else {
            message = "Apple Health is unavailable on this device."
            return
        }
        loading = true
        defer { loading = false }
        do {
            try await store.requestAuthorization(toShare: [], read: [steps])
            let now = Date()
            let predicate = HKQuery.predicateForSamples(
                withStart: Calendar.current.startOfDay(for: now), end: now, options: .strictStartDate
            )
            let query = HKStatisticsQueryDescriptor(
                predicate: .quantitySample(type: steps, predicate: predicate),
                options: .cumulativeSum
            )
            if let sum = try await query.result(for: store)?.sumQuantity() {
                total = Int(sum.doubleValue(for: .count()))
            } else {
                message = "No steps are available. Check Kova Health's Steps access in Apple Health."
            }
        } catch {
            message = "Couldn't read steps. Check Apple Health access and try again."
        }
    }
}
