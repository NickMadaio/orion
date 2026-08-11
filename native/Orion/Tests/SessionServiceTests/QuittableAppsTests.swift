//
//  The most destructive capability in the build, and the guards on it.
//
//  These are not about whether quitting works — they are about whether the
//  refusals hold. An empty list, a never-quittable app, and an app nobody added
//  all have to end in Orion doing nothing.
//

import XCTest
@testable import SessionService

final class QuittableAppsTests: XCTestCase {

    private var directory: URL!
    private var apps: QuittableApps!

    override func setUp() {
        super.setUp()
        directory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("orion-quit-\(UUID().uuidString)")
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        apps = QuittableApps(url: directory.appendingPathComponent("quittable-apps.json"))
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
        super.tearDown()
    }

    // MARK: The default

    /// The correct default for something that can throw away unsaved work.
    func testTheListStartsEmptyAndQuitsNothing() {
        XCTAssertTrue(apps.list().isEmpty)
        XCTAssertFalse(apps.permits("com.apple.MobileSMS"))

        let outcome = apps.quit(bundleID: "com.apple.MobileSMS", name: "Messages")

        XCTAssertEqual(outcome, .notPermitted("Messages"))
    }

    func testAnAppNobodyAddedIsNeverQuit() {
        apps.add(QuittableApp(bundleID: "com.apple.MobileSMS", name: "Messages"))

        let outcome = apps.quit(bundleID: "com.apple.Music", name: "Music")

        XCTAssertEqual(outcome, .notPermitted("Music"),
                       "being on the list is per-app, not a blanket permission")
    }

    // MARK: The never list

    func testOrionCannotBeMadeQuittable() {
        let added = apps.add(QuittableApp(bundleID: "com.nickmadaio.orion.app", name: "Orion"))

        XCTAssertFalse(added, "an assistant that can quit itself cannot be asked to stop")
        XCTAssertTrue(apps.list().isEmpty)
    }

    func testThePasswordManagerAndFinderCannotBeMadeQuittable() {
        XCTAssertFalse(apps.add(QuittableApp(bundleID: "com.1password.1password", name: "1Password")))
        XCTAssertFalse(apps.add(QuittableApp(bundleID: "com.apple.finder", name: "Finder")))
        XCTAssertTrue(apps.list().isEmpty)
    }

    /// Defence in depth: even a hand-edited file cannot make them quittable.
    func testANeverQuittableAppSmuggledIntoTheFileIsIgnored() throws {
        let smuggled = """
        [{"bundleID":"com.nickmadaio.orion.app","name":"Orion"},
         {"bundleID":"com.apple.MobileSMS","name":"Messages"}]
        """
        try Data(smuggled.utf8).write(to: directory.appendingPathComponent("quittable-apps.json"))

        XCTAssertEqual(apps.list().map(\.bundleID), ["com.apple.MobileSMS"])
        XCTAssertFalse(apps.permits("com.nickmadaio.orion.app"))
    }

    // MARK: Adding and removing

    func testAddingAndRemovingPersists() {
        apps.add(QuittableApp(bundleID: "com.apple.MobileSMS", name: "Messages"))
        XCTAssertTrue(apps.permits("com.apple.MobileSMS"))

        // A second instance over the same file — what a relaunch is.
        let reloaded = QuittableApps(url: directory.appendingPathComponent("quittable-apps.json"))
        XCTAssertTrue(reloaded.permits("com.apple.MobileSMS"))

        reloaded.remove("com.apple.MobileSMS")
        XCTAssertFalse(reloaded.permits("com.apple.MobileSMS"))
    }

    func testAddingTwiceDoesNotDuplicate() {
        apps.add(QuittableApp(bundleID: "com.apple.MobileSMS", name: "Messages"))
        apps.add(QuittableApp(bundleID: "com.apple.MobileSMS", name: "Messages"))

        XCTAssertEqual(apps.list().count, 1)
    }

    func testACorruptListIsEmptyRatherThanDangerous() throws {
        try Data("{ not json".utf8)
            .write(to: directory.appendingPathComponent("quittable-apps.json"))

        // Failing closed is right here and NOT right for the state file: an
        // unreadable quit-list means quit nothing, which is safe. An unreadable
        // session means say so, because pretending there is no session loses work.
        XCTAssertTrue(apps.list().isEmpty)
        XCTAssertEqual(apps.quit(bundleID: "com.apple.MobileSMS", name: "Messages"),
                       .notPermitted("Messages"))
    }

    // MARK: Never force

    /// A rule, asserted against the source: the polite quit lets an app put up
    /// "save changes?" and lets the user say no. Force-quitting throws work away.
    func testItNeverForceQuits() throws {
        let source = try String(
            contentsOf: URL(fileURLWithPath: #filePath)
                .deletingLastPathComponent().deletingLastPathComponent()
                .deletingLastPathComponent()
                .appendingPathComponent("Sources/SessionService/QuittableApps.swift"),
            encoding: .utf8
        )
        let code = source.split(separator: "\n", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.hasPrefix("//") }
            .joined(separator: "\n")

        XCTAssertFalse(code.contains("forceTerminate"),
                       "no focus session is worth somebody's unsaved document")
        XCTAssertTrue(code.contains("terminate()"))
    }

    func testCandidatesAreOfferedButNotPermitted() {
        // The distinction the whole design rests on: something Orion can SHOW
        // him is not something Orion may act on.
        for candidate in QuittableApps.candidates() {
            XCTAssertFalse(apps.permits(candidate.bundleID),
                           "\(candidate.name) was offered, not authorised")
        }
    }
}
