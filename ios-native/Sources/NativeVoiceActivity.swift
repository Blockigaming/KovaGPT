import ActivityKit
import Foundation
import UIKit

/// Visual activity only. This never records, grants permissions or starts a provider call.
@available(iOS 16.1, *)
@MainActor
final class NativeVoiceActivity {
    private var activity: Activity<KovaVoiceActivityAttributes>?
    private var pending: Task<Void, Never>?
    private var generation = 0
    private var observedPhase = "inactive"
    private static let permitted = Set(["idle", "requesting", "recording", "stopping", "transcribing", "chat", "synthesizing", "speaking", "inactive"])

    init() {
        // An app restart cannot establish that a previous recording is still active.
        for stale in Activity<KovaVoiceActivityAttributes>.activities {
            Task { await stale.end(using: nil, dismissalPolicy: .immediate) }
        }
    }

    func receive(_ phase: String) {
        guard Self.permitted.contains(phase) else { return }
        observedPhase = phase
        enqueue(UIApplication.shared.applicationState == .active ? phase : "foreground-required")
    }

    func enteredBackground() {
        if activity != nil { enqueue("foreground-required") }
    }

    func enteredForeground() { enqueue(observedPhase) }
    func end() { observedPhase = "inactive"; enqueue("inactive") }

    private func enqueue(_ phase: String) {
        generation += 1
        let token = generation
        let prior = pending
        pending = Task { [weak self] in
            await prior?.value
            guard let self, self.generation == token else { return }
            if phase == "inactive" {
                let old = self.activity
                self.activity = nil
                await old?.end(using: nil, dismissalPolicy: .immediate)
                return
            }
            let state = KovaVoiceActivityAttributes.ContentState(phase: phase)
            if let activity = self.activity {
                await activity.update(using: state)
            } else if ["recording", "speaking"].contains(phase),
                      UIApplication.shared.applicationState == .active,
                      ActivityAuthorizationInfo().areActivitiesEnabled {
                self.activity = try? Activity.request(
                    attributes: KovaVoiceActivityAttributes(sessionID: UUID()),
                    contentState: state,
                    pushType: nil
                )
            }
        }
    }
}
