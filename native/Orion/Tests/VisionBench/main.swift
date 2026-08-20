import AppKit
import Vision

/*
 Which Vision requests are fast enough to run during a break, on this Mac.

 Deliberately camera-free. Latency is a property of the model and the frame
 size, not of where the pixels came from, so this answers "can we afford to run
 it" without turning a lens on. Whether it can actually tell a phone from a mug
 is a separate question that needs real frames and consent, and it is not this.

 Read the numbers as a FLOOR: a frame with a person in it does marginally more
 work than a synthetic one, because there are detections to describe.
*/

func testFrame(width: Int, height: Int) -> CGImage {
    let space = CGColorSpaceCreateDeviceRGB()
    let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                            bytesPerRow: 0, space: space,
                            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue)!
    context.setFillColor(CGColor(red: 0.2, green: 0.22, blue: 0.25, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    // Something with edges, so the detectors have work to refuse rather than an
    // empty field they can reject in a single pass.
    for i in 0..<40 {
        let x = Double((i * 137) % width)
        let y = Double((i * 91) % height)
        context.setFillColor(CGColor(red: 0.5 + Double(i % 5) / 10, green: 0.4, blue: 0.35, alpha: 1))
        context.fillEllipse(in: CGRect(x: x, y: y, width: 60, height: 80))
    }
    return context.makeImage()!
}

struct Candidate {
    let name: String
    let note: String
    let make: () -> VNImageBasedRequest
}

let candidates: [Candidate] = [
    Candidate(name: "face rectangles",
              note: "is a face in frame at all",
              make: { VNDetectFaceRectanglesRequest() }),
    Candidate(name: "face landmarks",
              note: "76 points incl. pupils — where the eyes are pointed",
              make: { VNDetectFaceLandmarksRequest() }),
    Candidate(name: "body pose",
              note: "19 joints incl. wrists, ears, eyes — the phone posture",
              make: { VNDetectHumanBodyPoseRequest() }),
    Candidate(name: "hand pose",
              note: "21 hand landmarks — is something being held",
              make: { VNDetectHumanHandPoseRequest() }),
    Candidate(name: "human rectangles",
              note: "is a person there, cheapest possible presence check",
              make: { VNDetectHumanRectanglesRequest() }),
]

let sizes = [(640, 480), (1280, 720)]
let iterations = 25

print("Vision latency on this Mac — \(ProcessInfo.processInfo.processorCount) cores, "
      + "\(iterations) runs per request\n")

for (width, height) in sizes {
    let image = testFrame(width: width, height: height)
    print("\(width)×\(height)")
    print(String(repeating: "─", count: 64))

    for candidate in candidates {
        var samples: [Double] = []
        var failed: String?

        for _ in 0..<iterations {
            let request = candidate.make()
            let handler = VNImageRequestHandler(cgImage: image, options: [:])
            let started = DispatchTime.now().uptimeNanoseconds
            do {
                try handler.perform([request])
            } catch {
                failed = error.localizedDescription
                break
            }
            let elapsed = Double(DispatchTime.now().uptimeNanoseconds - started) / 1_000_000
            samples.append(elapsed)
        }

        if let failed {
            print(String(format: "  %-18s  unavailable — \(failed)", (candidate.name as NSString).utf8String!))
            continue
        }

        let sorted = samples.sorted()
        let median = sorted[sorted.count / 2]
        let worst = sorted.last ?? 0
        let perMinute = 60_000 / max(median, 0.001)

        print(String(format: "  %-18s median %6.1f ms   worst %6.1f ms   (%.0f frames/min possible)",
                     (candidate.name as NSString).utf8String!, median, worst, perMinute))
        print("                      \(candidate.note)")
    }
    print("")
}

print("A break samples at most once every few seconds, so anything under ~100 ms")
print("is free. The question is accuracy, not speed.")
