import Foundation
import HealthKit

struct StepReport: Encodable {
    struct Day: Encodable {
        let date: String
        let steps: Int
    }

    let version = 1
    let source = "kovagpt.apple-health"
    let days: [Day]

    @MainActor
    static func read(from store: HKHealthStore, now: Date = .now) async throws -> StepReport {
        let stepCount = HKQuantityType(.stepCount)
        try await store.requestAuthorization(toShare: [], read: [stepCount])

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let today = calendar.startOfDay(for: now)
        guard let start = calendar.date(byAdding: .day, value: -6, to: today) else {
            return StepReport(days: [])
        }
        let window = HKQuery.predicateForSamples(withStart: start, end: now, options: [])
        let query = HKStatisticsCollectionQueryDescriptor(
            predicate: .quantitySample(type: stepCount, predicate: window),
            options: .cumulativeSum,
            anchorDate: today,
            intervalComponents: DateComponents(calendar: calendar, timeZone: calendar.timeZone, day: 1)
        )
        let totals = try await query.result(for: store)

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        var days: [Day] = []
        totals.enumerateStatistics(from: start, to: now) { total, _ in
            guard let quantity = total.sumQuantity(),
                  let steps = Int(exactly: quantity.doubleValue(for: .count()).rounded()),
                  steps >= 0 else { return }
            days.append(Day(date: formatter.string(from: total.startDate), steps: steps))
        }
        return StepReport(days: days)
    }
}

enum StepReportFile {
    private static let name = "Apple Health Steps.kovahealth"

    private static var directory: URL {
        get throws {
            try FileManager.default.url(
                for: .documentDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: false
            ).appendingPathComponent("Reports", isDirectory: true)
        }
    }

    static var exists: Bool {
        guard let directory = try? directory else { return false }
        return FileManager.default.fileExists(atPath: directory.appendingPathComponent(name).path)
    }

    static func write(_ report: StepReport) throws {
        var folder = try directory
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var options = URLResourceValues()
        options.isExcludedFromBackup = true
        try folder.setResourceValues(options)
        let url = folder.appendingPathComponent(name)
        try JSONEncoder().encode(report).write(to: url, options: [.atomic, .completeFileProtection])
    }

    static func remove() throws {
        let url = try directory.appendingPathComponent(name)
        do {
            try FileManager.default.removeItem(at: url)
        } catch let error as CocoaError where error.code == .fileNoSuchFile {
            return
        }
    }
}
