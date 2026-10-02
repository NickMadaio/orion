import XCTest
@testable import Orion
final class FluxWiringTests: XCTestCase {
    func testLiveSpeechURLUsesFluxTurnDetection() throws {
        let url = try XCTUnwrap(DeepgramConfig.url())
        XCTAssertEqual(url.path, "/v2/listen")
        let items = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
        XCTAssertEqual(items.first { $0.name == "model" }?.value, "flux-general-en")
        XCTAssertNil(items.first { $0.name == "endpointing" })
        XCTAssertNil(items.first { $0.name == "utterance_end_ms" })
    }
}
