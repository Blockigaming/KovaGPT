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
            if let message {
                Text(message).foregroundStyle(.secondary)
            }
        }
        .padding(24)
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
