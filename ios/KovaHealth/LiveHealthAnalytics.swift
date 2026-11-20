import Foundation
import HealthKit

struct LiveHealthAnalytics: Encodable {
    struct Day: Encodable {
        let date: String
        let value: Double
    }

    let asOf: String
    var metrics: [String: [Day]]

    private struct Quantity {
        let id: HKQuantityTypeIdentifier
        let unit: HKUnit
        let options: HKStatisticsOptions
        var scale: Double = 1
    }

    private static let perMinute = HKUnit.count().unitDivided(by: .minute())
    private static let quantities = [
        Quantity(id: .stepCount, unit: .count(), options: .cumulativeSum),
        Quantity(id: .distanceWalkingRunning, unit: .meterUnit(with: .kilo), options: .cumulativeSum),
        Quantity(id: .activeEnergyBurned, unit: .kilocalorie(), options: .cumulativeSum),
        Quantity(id: .basalEnergyBurned, unit: .kilocalorie(), options: .cumulativeSum),
        Quantity(id: .appleExerciseTime, unit: .minute(), options: .cumulativeSum),
        Quantity(id: .appleStandTime, unit: .minute(), options: .cumulativeSum),
        Quantity(id: .flightsClimbed, unit: .count(), options: .cumulativeSum),
        Quantity(id: .distanceCycling, unit: .meterUnit(with: .kilo), options: .cumulativeSum),
        Quantity(id: .distanceSwimming, unit: .meter(), options: .cumulativeSum),
        Quantity(id: .heartRate, unit: perMinute, options: .discreteAverage),
        Quantity(id: .restingHeartRate, unit: perMinute, options: .discreteAverage),
        Quantity(id: .heartRateVariabilitySDNN, unit: .secondUnit(with: .milli), options: .discreteAverage),
        Quantity(id: .walkingHeartRateAverage, unit: perMinute, options: .discreteAverage),
        Quantity(id: .respiratoryRate, unit: perMinute, options: .discreteAverage),
        Quantity(id: .oxygenSaturation, unit: .percent(), options: .discreteAverage, scale: 100),
        Quantity(id: .vo2Max, unit: .literUnit(with: .milli).unitDivided(by: HKUnit.gramUnit(with: .kilo).unitMultiplied(by: .minute())), options: .discreteAverage),
        Quantity(id: .bodyMass, unit: .gramUnit(with: .kilo), options: .mostRecent),
        Quantity(id: .bodyFatPercentage, unit: .percent(), options: .mostRecent, scale: 100),
        Quantity(id: .bodyMassIndex, unit: .count(), options: .mostRecent),
    ]

    static var sampleTypes: [HKSampleType] {
        let quantityTypes: [HKSampleType] = quantities.compactMap { HKObjectType.quantityType(forIdentifier: $0.id) }
        var types = quantityTypes + [HKObjectType.workoutType()]
        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { types.append(sleep) }
        return types
    }

    @MainActor
    static func read(from store: HKHealthStore) async -> LiveHealthAnalytics {
        let now = Date.now
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let today = calendar.startOfDay(for: now)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        var report = LiveHealthAnalytics(asOf: formatter.string(from: now), metrics: [:])
        guard let start = calendar.date(byAdding: .day, value: -89, to: today) else { return report }
        let window = HKQuery.predicateForSamples(withStart: start, end: now, options: [])
        let interval = DateComponents(calendar: calendar, timeZone: calendar.timeZone, day: 1)

        for metric in quantities {
            if Task.isCancelled { return report }
            guard let type = HKObjectType.quantityType(forIdentifier: metric.id) else { continue }
            let query = HKStatisticsCollectionQueryDescriptor(
                predicate: .quantitySample(type: type, predicate: window),
                options: metric.options,
                anchorDate: today,
                intervalComponents: interval
            )
            guard let totals = try? await query.result(for: store) else { continue }
            var days: [Day] = []
            totals.enumerateStatistics(from: start, to: now) { bucket, _ in
                let quantity: HKQuantity?
                switch metric.options {
                case .cumulativeSum: quantity = bucket.sumQuantity()
                case .discreteAverage: quantity = bucket.averageQuantity()
                default: quantity = bucket.mostRecentQuantity()
                }
                guard let value = quantity?.doubleValue(for: metric.unit), value.isFinite, value >= 0 else { return }
                days.append(Day(date: formatter.string(from: bucket.startDate), value: value * metric.scale))
            }
            if !days.isEmpty {
                let key = metric.id.rawValue.replacingOccurrences(of: "HKQuantityTypeIdentifier", with: "")
                report.metrics[key] = days
            }
        }

        if let workouts = try? await readSamples(from: store, type: HKObjectType.workoutType(), predicate: window) {
            let byDay = Dictionary(grouping: workouts.filter { $0.startDate >= start }) { formatter.string(from: $0.startDate) }
            if !byDay.isEmpty {
                report.metrics["Workouts"] = byDay.keys.sorted().map { Day(date: $0, value: Double(byDay[$0]?.count ?? 0)) }
            }
        }
        if let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis),
           let samples = try? await readSamples(from: store, type: sleepType, predicate: window) {
            let asleep = samples.compactMap { $0 as? HKCategorySample }.filter { sample in
                guard sample.endDate >= start,
                      let value = HKCategoryValueSleepAnalysis(rawValue: sample.value) else { return false }
                return HKCategoryValueSleepAnalysis.allAsleepValues.contains(value)
            }
            let byDay = Dictionary(grouping: asleep) { formatter.string(from: $0.endDate) }
            let days = byDay.keys.sorted().map { day in
                var end = Date.distantPast
                var seconds = 0.0
                for sample in byDay[day, default: []].sorted(by: { $0.startDate < $1.startDate }) {
                    seconds += max(0, sample.endDate.timeIntervalSince(max(end, sample.startDate)))
                    end = max(end, sample.endDate)
                }
                return Day(date: day, value: seconds / 3600)
            }
            if !days.isEmpty { report.metrics["SleepAnalysis"] = days }
        }
        return report
    }

    private static func readSamples(
        from store: HKHealthStore, type: HKSampleType, predicate: NSPredicate
    ) async throws -> [HKSample] {
        try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) {
                _, samples, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: samples ?? []) }
            }
            store.execute(query)
        }
    }
}
