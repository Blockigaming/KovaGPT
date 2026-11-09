import XCTest
import WebKit
@testable import KovaGPT

@MainActor
final class AccountWebStoresTests: XCTestCase {
    func testSecondProfileIdentifierSurvivesRecreationAndRejectsOtherSlots() {
        let suite = "KovaGPT-Test-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let identifier = AccountWebStores.secondIdentifier(defaults: defaults)
        let reopened = UserDefaults(suiteName: suite)!
        XCTAssertEqual(AccountWebStores.secondIdentifier(defaults: reopened), identifier)
        XCTAssertNil(AccountWebStores.store(for: 0, defaults: defaults))
        XCTAssertNil(AccountWebStores.store(for: 3, defaults: defaults))
    }

    func testIndependentPersistentCookieContainers() async throws {
        guard #available(iOS 17.0, *) else { throw XCTSkip("Second persistent store requires iOS 17") }
        let suite = "KovaGPT-Test-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        let first = AccountWebStores.store(for: 1, defaults: defaults)!
        let second = AccountWebStores.store(for: 2, defaults: defaults)!
        let identifier = second.identifier!
        let name = "kova-isolation-\(UUID().uuidString)"
        XCTAssertTrue(first.isPersistent)
        XCTAssertTrue(second.isPersistent)
        XCTAssertNil(first.identifier)
        XCTAssertNotNil(second.identifier)
        let cookie = HTTPCookie(properties: [.domain: "profile-test.kovagpt.invalid", .path: "/", .name: name, .value: "account-two"] )!
        await second.httpCookieStore.setCookie(cookie)
        let firstCookies = await first.httpCookieStore.allCookies()
        let secondCookies = await second.httpCookieStore.allCookies()
        XCTAssertFalse(firstCookies.contains(where: { $0.name == name }))
        XCTAssertTrue(secondCookies.contains(where: { $0.name == name && $0.value == "account-two" }))
        await second.httpCookieStore.deleteCookie(cookie)
        defaults.removePersistentDomain(forName: suite)
        try await WKWebsiteDataStore.remove(forIdentifier: identifier)
    }
}
