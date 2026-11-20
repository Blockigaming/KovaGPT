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
        var signed = false
    }

    private static let perMinute = HKUnit.count().unitDivided(by: .minute())
    private static func quantity(_ identifier: String, _ unit: HKUnit, _ options: HKStatisticsOptions, scale: Double = 1, signed: Bool = false) -> Quantity {
        Quantity(id: HKQuantityTypeIdentifier(rawValue: "HKQuantityTypeIdentifier" + identifier), unit: unit, options: options, scale: scale, signed: signed)
    }

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
        quantity("PushCount", .count(), .cumulativeSum),
        quantity("DistanceWheelchair", .meterUnit(with: .kilo), .cumulativeSum),
        quantity("SwimmingStrokeCount", .count(), .cumulativeSum),
        quantity("DistanceDownhillSnowSports", .meterUnit(with: .kilo), .cumulativeSum),
        quantity("DistanceRowing", .meterUnit(with: .kilo), .cumulativeSum),
        quantity("DistancePaddleSports", .meterUnit(with: .kilo), .cumulativeSum),
        quantity("DistanceCrossCountrySkiing", .meterUnit(with: .kilo), .cumulativeSum),
        quantity("DistanceSkatingSports", .meterUnit(with: .kilo), .cumulativeSum),
        quantity("PhysicalEffort", HKUnit.kilocalorie().unitDivided(by: HKUnit.hour().unitMultiplied(by: .gramUnit(with: .kilo))), .discreteAverage),
        quantity("WalkingSpeed", .meter().unitDivided(by: .second()), .discreteAverage),
        quantity("WalkingStepLength", .meterUnit(with: .centi), .discreteAverage),
        quantity("WalkingAsymmetryPercentage", .percent(), .discreteAverage, scale: 100),
        quantity("WalkingDoubleSupportPercentage", .percent(), .discreteAverage, scale: 100),
        quantity("AppleWalkingSteadiness", .percent(), .discreteAverage, scale: 100),
        quantity("SixMinuteWalkTestDistance", .meter(), .discreteAverage),
        quantity("StairAscentSpeed", .meter().unitDivided(by: .second()), .discreteAverage),
        quantity("StairDescentSpeed", .meter().unitDivided(by: .second()), .discreteAverage),
        quantity("RunningSpeed", .meter().unitDivided(by: .second()), .discreteAverage),
        quantity("RunningPower", .watt(), .discreteAverage),
        quantity("RunningStrideLength", .meter(), .discreteAverage),
        quantity("RunningGroundContactTime", .secondUnit(with: .milli), .discreteAverage),
        quantity("RunningVerticalOscillation", .meterUnit(with: .centi), .discreteAverage),
        quantity("CyclingSpeed", .meter().unitDivided(by: .second()), .discreteAverage),
        quantity("CyclingPower", .watt(), .discreteAverage),
        quantity("CyclingCadence", perMinute, .discreteAverage),
        quantity("CyclingFunctionalThresholdPower", .watt(), .mostRecent),
        quantity("HeartRateRecoveryOneMinute", perMinute, .discreteAverage),
        quantity("AtrialFibrillationBurden", .percent(), .discreteAverage, scale: 100),
        quantity("BloodPressureSystolic", .millimeterOfMercury(), .discreteAverage),
        quantity("BloodPressureDiastolic", .millimeterOfMercury(), .discreteAverage),
        quantity("BloodGlucose", .gramUnit(with: .milli).unitDivided(by: .literUnit(with: .deci)), .discreteAverage),
        quantity("BodyTemperature", .degreeCelsius(), .discreteAverage, signed: true),
        quantity("AppleSleepingWristTemperature", .degreeCelsius(), .discreteAverage, signed: true),
        quantity("BasalBodyTemperature", .degreeCelsius(), .discreteAverage, signed: true),
        quantity("PeripheralPerfusionIndex", .percent(), .discreteAverage, scale: 100),
        quantity("Height", .meterUnit(with: .centi), .mostRecent),
        quantity("WaistCircumference", .meterUnit(with: .centi), .mostRecent),
        quantity("LeanBodyMass", .gramUnit(with: .kilo), .mostRecent),
        quantity("TimeInDaylight", .minute(), .cumulativeSum),
        quantity("EnvironmentalAudioExposure", .decibelAWeightedSoundPressureLevel(), .discreteAverage),
        quantity("HeadphoneAudioExposure", .decibelAWeightedSoundPressureLevel(), .discreteAverage),
        quantity("EnvironmentalSoundReduction", .decibelAWeightedSoundPressureLevel(), .discreteAverage),
        quantity("DietaryWater", .literUnit(with: .milli), .cumulativeSum),
        quantity("DietaryEnergyConsumed", .kilocalorie(), .cumulativeSum),
        quantity("DietaryCaffeine", .gramUnit(with: .milli), .cumulativeSum),
        quantity("DietaryProtein", .gram(), .cumulativeSum),
        quantity("DietaryCarbohydrates", .gram(), .cumulativeSum),
        quantity("DietarySugar", .gram(), .cumulativeSum),
        quantity("DietaryFiber", .gram(), .cumulativeSum),
        quantity("DietaryFatTotal", .gram(), .cumulativeSum),
        quantity("DietaryFatSaturated", .gram(), .cumulativeSum),
        quantity("DietaryFatMonounsaturated", .gram(), .cumulativeSum),
        quantity("DietaryFatPolyunsaturated", .gram(), .cumulativeSum),
        quantity("DietaryCholesterol", .gramUnit(with: .milli), .cumulativeSum),
        quantity("DietarySodium", .gramUnit(with: .milli), .cumulativeSum),
        quantity("DietaryPotassium", .gramUnit(with: .milli), .cumulativeSum),
        quantity("DietaryCalcium", .gramUnit(with: .milli), .cumulativeSum),
        quantity("DietaryIron", .gramUnit(with: .milli), .cumulativeSum),
        quantity("DietaryMagnesium", .gramUnit(with: .milli), .cumulativeSum),
        quantity("DietaryZinc", .gramUnit(with: .milli), .cumulativeSum),
        quantity("DietaryPhosphorus", .gramUnit(with: .milli), .cumulativeSum),
        quantity("DietaryVitaminC", .gramUnit(with: .milli), .cumulativeSum),
        quantity("DietaryVitaminB6", .gramUnit(with: .milli), .cumulativeSum),
        quantity("DietaryVitaminB12", .gramUnit(with: .micro), .cumulativeSum),
        quantity("DietaryFolate", .gramUnit(with: .micro), .cumulativeSum),
        quantity("DietaryThiamin", .gramUnit(with: .milli), .cumulativeSum),
        quantity("DietaryRiboflavin", .gramUnit(with: .milli), .cumulativeSum),
        quantity("DietaryNiacin", .gramUnit(with: .milli), .cumulativeSum),
        quantity("DietaryBiotin", .gramUnit(with: .micro), .cumulativeSum),
        quantity("DietaryPantothenicAcid", .gramUnit(with: .milli), .cumulativeSum),
        quantity("DietaryVitaminK", .gramUnit(with: .micro), .cumulativeSum),
        quantity("DietarySelenium", .gramUnit(with: .micro), .cumulativeSum),
        quantity("DietaryIodine", .gramUnit(with: .micro), .cumulativeSum),
        quantity("DietaryCopper", .gramUnit(with: .milli), .cumulativeSum),
        quantity("DietaryManganese", .gramUnit(with: .milli), .cumulativeSum),
        quantity("NumberOfAlcoholicBeverages", .count(), .cumulativeSum),
        quantity("AppleSleepingBreathingDisturbances", .count(), .discreteAverage),
        quantity("NumberOfTimesFallen", .count(), .cumulativeSum),
        quantity("ForcedVitalCapacity", .liter(), .discreteAverage),
        quantity("ForcedExpiratoryVolume1", .liter(), .discreteAverage),
        quantity("PeakExpiratoryFlowRate", .liter().unitDivided(by: .minute()), .discreteAverage)
    ]

    private static let countableCategoryIDs = [
        "ToothbrushingEvent", "HandwashingEvent",
        "HighHeartRateEvent", "LowHeartRateEvent", "IrregularHeartRhythmEvent", "LowCardioFitnessEvent",
        "AppleWalkingSteadinessEvent", "EnvironmentalAudioExposureEvent", "HeadphoneAudioExposureEvent", "MenstrualFlow",
        "IntermenstrualBleeding", "InfrequentMenstrualCycles", "IrregularMenstrualCycles", "ProlongedMenstrualPeriods",
        "PersistentIntermenstrualBleeding", "OvulationTestResult", "PregnancyTestResult", "ProgesteroneTestResult",
        "CervicalMucusQuality", "Headache", "Fatigue", "Coughing",
        "Fever", "Chills", "ShortnessOfBreath", "ChestTightnessOrPain",
        "RapidPoundingOrFlutteringHeartbeat", "Nausea", "Vomiting", "Dizziness",
        "Diarrhea", "Constipation", "AbdominalCramps", "Bloating",
        "SoreThroat", "SleepChanges", "MoodChanges", "AppetiteChanges",
        "HotFlashes", "NightSweats", "Acne", "DrySkin",
        "HairLoss", "LowerBackPain", "GeneralizedBodyAche", "PelvicPain",
        "Wheezing", "SinusCongestion", "RunnyNose", "LossOfSmell",
        "LossOfTaste"
    ]

    private static func countableType(_ key: String) -> HKCategoryType? {
        HKObjectType.categoryType(forIdentifier: HKCategoryTypeIdentifier(rawValue: "HKCategoryTypeIdentifier" + key))
    }

    static var sampleTypes: [HKSampleType] {
        let quantityTypes: [HKSampleType] = quantities.compactMap { HKObjectType.quantityType(forIdentifier: $0.id) }
        var types = quantityTypes + [HKObjectType.workoutType()]
        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { types.append(sleep) }
        if let mindful = HKObjectType.categoryType(forIdentifier: .mindfulSession) { types.append(mindful) }
        types.append(contentsOf: countableCategoryIDs.compactMap(countableType))
        if #available(iOS 18.0, *) { types.append(HKObjectType.stateOfMindType()) }
        return types
    }

    @MainActor
    static func read(
        from store: HKHealthStore,
        changing: Set<String>,
        previous: LiveHealthAnalytics?
    ) async -> LiveHealthAnalytics {
        let now = Date.now
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let today = calendar.startOfDay(for: now)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        let asOf = formatter.string(from: now)
        let canReuse = previous?.asOf == asOf && !changing.isEmpty
        var report = LiveHealthAnalytics(asOf: asOf, metrics: canReuse ? previous?.metrics ?? [:] : [:])
        let includes: (HKSampleType) -> Bool = { !canReuse || changing.contains($0.identifier) }
        guard let start = calendar.date(byAdding: .day, value: -364, to: today) else { return report }
        let window = HKQuery.predicateForSamples(withStart: start, end: now, options: [])
        let interval = DateComponents(calendar: calendar, timeZone: calendar.timeZone, day: 1)

        for metric in quantities {
            if Task.isCancelled { return report }
            guard let type = HKObjectType.quantityType(forIdentifier: metric.id), includes(type) else { continue }
            let key = metric.id.rawValue.replacingOccurrences(of: "HKQuantityTypeIdentifier", with: "")
            report.metrics.removeValue(forKey: key)
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
                guard let quantity, quantity.is(compatibleWith: metric.unit) else { return }
                let value = quantity.doubleValue(for: metric.unit)
                guard value.isFinite, value >= 0 || metric.signed else { return }
                days.append(Day(date: formatter.string(from: bucket.startDate), value: value * metric.scale))
            }
            if !days.isEmpty { report.metrics[key] = days }
        }

        let workoutType = HKObjectType.workoutType()
        if includes(workoutType) {
            report.metrics.removeValue(forKey: "Workouts")
            report.metrics.removeValue(forKey: "WorkoutDuration")
        }
        if includes(workoutType),
           let workouts = try? await readSamples(from: store, type: workoutType, predicate: window) {
            let byDay = Dictionary(grouping: workouts.filter { $0.startDate >= start }) { formatter.string(from: $0.startDate) }
            if !byDay.isEmpty {
                report.metrics["Workouts"] = byDay.keys.sorted().map { Day(date: $0, value: Double(byDay[$0]?.count ?? 0)) }
                report.metrics["WorkoutDuration"] = byDay.keys.sorted().map { day in
                    let seconds = byDay[day, default: []].compactMap { ($0 as? HKWorkout)?.duration }.reduce(0, +)
                    return Day(date: day, value: seconds / 60)
                }
            }
        }
        if let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis), includes(sleepType) {
            let samples = (try? await readSamples(from: store, type: sleepType, predicate: window)) ?? []
            let categories = samples.compactMap { $0 as? HKCategorySample }.filter { $0.endDate >= start }
            let groups: [(String, Set<HKCategoryValueSleepAnalysis>)] = [
                ("SleepAnalysis", HKCategoryValueSleepAnalysis.allAsleepValues),
                ("SleepCore", [.asleepCore]), ("SleepDeep", [.asleepDeep]), ("SleepREM", [.asleepREM]),
                ("SleepAwake", [.awake]), ("SleepInBed", [.inBed])
            ]
            for (key, stages) in groups {
                let matching = categories.filter { sample in
                    guard let stage = HKCategoryValueSleepAnalysis(rawValue: sample.value) else { return false }
                    return stages.contains(stage)
                }
                let days = durationDays(matching, formatter: formatter)
                report.metrics[key] = days.isEmpty ? nil : days
            }
        }
        if let type = HKObjectType.categoryType(forIdentifier: .mindfulSession), includes(type) {
            let samples = (try? await readSamples(from: store, type: type, predicate: window)) ?? []
            let days = durationDays(samples.filter { $0.endDate >= start }, formatter: formatter)
            report.metrics["MindfulSession"] = days.isEmpty ? nil : days
        }
        if #available(iOS 18.0, *), case let moodType = HKObjectType.stateOfMindType(), includes(moodType) {
            let samples = (try? await readSamples(from: store, type: moodType, predicate: window)) ?? []
            let moods = samples.compactMap { $0 as? HKStateOfMind }.filter { $0.startDate >= start }
            let byDay = Dictionary(grouping: moods) { formatter.string(from: $0.startDate) }
            report.metrics["StateOfMind"] = byDay.isEmpty ? nil : byDay.keys.sorted().compactMap { day in
                guard let values = byDay[day], !values.isEmpty else { return nil }
                return Day(date: day, value: values.map(\.valence).reduce(0, +) / Double(values.count))
            }
        }
        for key in countableCategoryIDs {
            if Task.isCancelled { return report }
            guard let type = countableType(key), includes(type) else { continue }
            report.metrics.removeValue(forKey: key)
            guard let samples = try? await readSamples(from: store, type: type, predicate: window) else { continue }
            let byDay = Dictionary(grouping: samples.filter { $0.startDate >= start }) { formatter.string(from: $0.startDate) }
            if !byDay.isEmpty {
                report.metrics[key] = byDay.keys.sorted().map { Day(date: $0, value: Double(byDay[$0, default: []].count)) }
            }
        }
        return report
    }

    private static func durationDays(_ samples: [HKSample], formatter: DateFormatter) -> [Day] {
        let byDay = Dictionary(grouping: samples) { formatter.string(from: $0.endDate) }
        return byDay.keys.sorted().map { day in
            var end = Date.distantPast
            var seconds = 0.0
            for sample in byDay[day, default: []].sorted(by: { $0.startDate < $1.startDate }) {
                seconds += max(0, sample.endDate.timeIntervalSince(max(end, sample.startDate)))
                end = max(end, sample.endDate)
            }
            return Day(date: day, value: seconds / 3600)
        }
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
