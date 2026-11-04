import XCTest
import MouseKit
@testable import ActivityKit

final class ClassificationTests: XCTestCase {
    func testWellKnownAppsLandInTheirCategory() {
        XCTAssertEqual(AppClassifier.category(bundleId: "com.apple.Safari", name: "Safari", isGame: false), .browser)
        XCTAssertEqual(AppClassifier.category(bundleId: "company.thebrowser.Browser", name: "Arc", isGame: false), .browser)
        XCTAssertEqual(AppClassifier.category(bundleId: "com.microsoft.VSCode", name: "Code", isGame: false), .work)
        XCTAssertEqual(AppClassifier.category(bundleId: "com.apple.dt.Xcode", name: "Xcode", isGame: false), .work)
        XCTAssertEqual(AppClassifier.category(bundleId: "com.apple.iWork.Pages", name: "Pages", isGame: false), .work)
        XCTAssertEqual(AppClassifier.category(bundleId: "com.microsoft.Word", name: "Microsoft Word", isGame: false), .work)
        XCTAssertEqual(AppClassifier.category(bundleId: "md.obsidian", name: "Obsidian", isGame: false), .study)
        XCTAssertEqual(AppClassifier.category(bundleId: "com.hnc.Discord", name: "Discord", isGame: false), .chat)
        XCTAssertEqual(AppClassifier.category(bundleId: "com.apple.MobileSMS", name: "Messages", isGame: false), .chat)
        XCTAssertEqual(AppClassifier.category(bundleId: "com.spotify.client", name: "Spotify", isGame: false), .media)
        XCTAssertEqual(AppClassifier.category(bundleId: "com.apple.finder", name: "Finder", isGame: false), .system)
        XCTAssertEqual(AppClassifier.category(bundleId: "com.example.unknown", name: "Mystery", isGame: false), .other)
        XCTAssertEqual(AppClassifier.category(bundleId: nil, name: "TikTok", isGame: false), .social)
    }

    func testAGameWinsOverTheAppCategory() {
        XCTAssertEqual(AppClassifier.category(bundleId: "com.example.x", name: "Whatever", isGame: true), .game)
    }

    func testJavaMinecraftIsAGameByPathAndNotAPlainJdk() {
        let mc = GameClassifier.Facts(bundleId: nil, name: "java", isJavaProcess: true,
                                      executablePath: "/Users/someone/Library/Application Support/PrismLauncher/java/bin/java")
        XCTAssertEqual(AppClassifier.category(facts: mc), .game)
        XCTAssertEqual(AppClassifier.gameName(facts: mc), "Minecraft")
        let jdk = GameClassifier.Facts(bundleId: nil, name: "java", isJavaProcess: true,
                                       executablePath: "/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home/bin/java")
        XCTAssertNotEqual(AppClassifier.category(facts: jdk), .game)
        XCTAssertNil(AppClassifier.gameName(facts: jdk))
    }

    func testDomainFromAUrlDropsSchemeWwwPathAndQuery() {
        XCTAssertEqual(SiteClassifier.domain(fromURL: "https://www.youtube.com/watch?v=abc&t=3"), "youtube.com")
        XCTAssertEqual(SiteClassifier.domain(fromURL: "http://m.reddit.com/r/swift"), "reddit.com")
        XCTAssertEqual(SiteClassifier.domain(fromURL: "https://docs.google.com/document/d/1/edit"), "docs.google.com")
        XCTAssertNil(SiteClassifier.domain(fromURL: "about:blank"))
        XCTAssertNil(SiteClassifier.domain(fromURL: ""))
    }

    func testSitesClassify() {
        XCTAssertEqual(SiteClassifier.category(domain: "youtube.com"), .video)
        XCTAssertEqual(SiteClassifier.category(domain: "netflix.com"), .video)
        XCTAssertEqual(SiteClassifier.category(domain: "twitch.tv"), .video)
        XCTAssertEqual(SiteClassifier.category(domain: "reddit.com"), .social)
        XCTAssertEqual(SiteClassifier.category(domain: "old.reddit.com"), .social)
        XCTAssertEqual(SiteClassifier.category(domain: "instagram.com"), .social)
        XCTAssertEqual(SiteClassifier.category(domain: "docs.google.com"), .work)
        XCTAssertEqual(SiteClassifier.category(domain: "github.com"), .work)
        XCTAssertEqual(SiteClassifier.category(domain: "canvas.northeastern.edu"), .study)
        XCTAssertEqual(SiteClassifier.category(domain: "en.wikipedia.org"), .study)
        XCTAssertEqual(SiteClassifier.category(domain: "amazon.co.uk"), .shopping)
        XCTAssertEqual(SiteClassifier.category(domain: "bbc.co.uk"), .news)
        XCTAssertEqual(SiteClassifier.category(domain: "example.org"), .other)
        XCTAssertNil(SiteClassifier.category(domain: nil))
    }

    func testALookalikeDomainIsNotTheRealSite() {
        XCTAssertEqual(SiteClassifier.category(domain: "notyoutube.com"), .other)
        XCTAssertEqual(SiteClassifier.category(domain: "youtube.com.evil.io"), .other)
    }
}
